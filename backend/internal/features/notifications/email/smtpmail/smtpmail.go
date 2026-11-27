// Package smtpmail is the NOTIFICATIONS_MAILER=smtp adapter (notifications-v2
// D13): plain SMTP without auth or TLS to NOTIFICATIONS_SMTP_HOST:PORT —
// Mailpit in the dev compose. It sends one multipart/alternative message
// (text + HTML, quoted-printable) and classifies failures: SMTP 5xx and
// invalid messages wrap email.ErrPermanent, everything else is transient.
// Errors never carry the server text or any address.
package smtpmail

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/email"
)

// Mailer sends through one SMTP server.
type Mailer struct {
	host string
	addr string
	now  func() time.Time
}

var _ email.Mailer = (*Mailer)(nil)

// New returns an SMTP mailer for host:port.
func New(host string, port int) *Mailer {
	return &Mailer{host: host, addr: net.JoinHostPort(host, strconv.Itoa(port)), now: time.Now}
}

// Addr is the host:port the mailer dials.
func (m *Mailer) Addr() string { return m.addr }

// Send delivers msg; ctx bounds the whole exchange (dial included). The
// provider id is the Message-ID (plain SMTP returns no stable id).
func (m *Mailer) Send(ctx context.Context, msg email.Message) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	to, err := parseAddress(msg.To)
	if err != nil {
		return "", fmt.Errorf("%w: invalid recipient address", email.ErrPermanent)
	}
	from, err := parseAddress(msg.From)
	if err != nil {
		return "", fmt.Errorf("%w: invalid sender address", email.ErrPermanent)
	}
	data, err := build(msg, from, to, m.now())
	if err != nil {
		return "", fmt.Errorf("%w: %s", email.ErrPermanent, err.Error())
	}

	var d net.Dialer
	conn, err := d.DialContext(ctx, "tcp", m.addr)
	if err != nil {
		return "", errors.New("smtp connect: transient failure")
	}
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}
	c, err := smtp.NewClient(conn, m.host)
	if err != nil {
		_ = conn.Close()
		return "", classify("greeting", err)
	}
	defer c.Close()
	if err := c.Mail(from.Address); err != nil {
		return "", classify("mail", err)
	}
	if err := c.Rcpt(to.Address); err != nil {
		return "", classify("rcpt", err)
	}
	w, err := c.Data()
	if err != nil {
		return "", classify("data", err)
	}
	if _, err := w.Write(data); err != nil {
		return "", classify("data", err)
	}
	if err := w.Close(); err != nil {
		return "", classify("data", err)
	}
	_ = c.Quit() // the message is accepted; a failed QUIT changes nothing
	return msg.MessageID, nil
}

func parseAddress(v string) (*mail.Address, error) {
	if strings.ContainsAny(v, "\r\n") {
		return nil, errors.New("line break")
	}
	return mail.ParseAddress(v)
}

// classify maps an SMTP exchange error to the sender's classes without the
// server's text (it may echo the address).
func classify(step string, err error) error {
	var tp *textproto.Error
	if errors.As(err, &tp) {
		if tp.Code >= 500 && tp.Code < 600 {
			return fmt.Errorf("%w: smtp %s rejected (%d)", email.ErrPermanent, step, tp.Code)
		}
		return fmt.Errorf("smtp %s deferred (%d)", step, tp.Code)
	}
	return fmt.Errorf("smtp %s: transient failure", step)
}

var headerName = regexp.MustCompile(`^[A-Za-z0-9-]{1,64}$`)

// reserved headers are written by build itself.
var reserved = map[string]bool{
	"From": true, "To": true, "Subject": true, "Date": true, "Message-Id": true,
	"Mime-Version": true, "Content-Type": true, "Content-Transfer-Encoding": true, "Bcc": true, "Cc": true,
}

// build writes the RFC 5322 message with CRLF line ends.
func build(msg email.Message, from, to *mail.Address, now time.Time) ([]byte, error) {
	if strings.ContainsAny(msg.MessageID, "\r\n") || !strings.HasPrefix(msg.MessageID, "<") || !strings.HasSuffix(msg.MessageID, ">") {
		return nil, errors.New("invalid Message-ID")
	}
	extra := make([]string, 0, len(msg.Headers))
	for name, value := range msg.Headers {
		canonical := textproto.CanonicalMIMEHeaderKey(name)
		if !headerName.MatchString(name) || reserved[canonical] {
			return nil, errors.New("invalid header name")
		}
		if strings.ContainsAny(value, "\r\n") {
			return nil, errors.New("invalid header value")
		}
		extra = append(extra, name)
	}
	sort.Strings(extra)

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	for _, part := range []struct{ contentType, content string }{
		{"text/plain; charset=utf-8", msg.Text},
		{"text/html; charset=utf-8", msg.HTML},
	} {
		pw, err := mw.CreatePart(textproto.MIMEHeader{
			"Content-Type":              {part.contentType},
			"Content-Transfer-Encoding": {"quoted-printable"},
		})
		if err != nil {
			return nil, err
		}
		qp := quotedprintable.NewWriter(pw)
		if _, err := qp.Write([]byte(part.content)); err != nil {
			return nil, err
		}
		if err := qp.Close(); err != nil {
			return nil, err
		}
	}
	if err := mw.Close(); err != nil {
		return nil, err
	}

	var b bytes.Buffer
	header := func(name, value string) { b.WriteString(name + ": " + value + "\r\n") }
	header("From", from.String())
	header("To", to.String())
	header("Subject", encodeSubject(msg.Subject))
	header("Date", now.Format(time.RFC1123Z))
	header("Message-ID", msg.MessageID)
	header("MIME-Version", "1.0")
	for _, name := range extra {
		header(name, msg.Headers[name])
	}
	header("Content-Type", `multipart/alternative; boundary="`+mw.Boundary()+`"`)
	b.WriteString("\r\n")
	b.Write(body.Bytes())
	return b.Bytes(), nil
}

// encodeSubject RFC 2047-encodes a non-ASCII or control-bearing subject and
// folds between encoded words to keep lines short.
func encodeSubject(s string) string {
	return strings.ReplaceAll(mime.QEncoding.Encode("utf-8", s), "?= =?", "?=\r\n =?")
}
