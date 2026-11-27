package smtpmail

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net"
	"net/mail"
	"net/textproto"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/email"
)

// fakeServer is an in-process SMTP server on loopback (net/textproto): it
// records the envelope and the DATA payload and can reject one command.
type fakeServer struct {
	ln       net.Listener
	rejectAt string // "MAIL", "RCPT" or "DATA"
	code     int
	stall    bool

	mu       sync.Mutex
	from, to []string
	data     []byte
	done     chan struct{}
}

func startFakeServer(t *testing.T, rejectAt string, code int) *fakeServer {
	t.Helper()
	return startServer(t, rejectAt, code, false)
}

func startServer(t *testing.T, rejectAt string, code int, stall bool) *fakeServer {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	s := &fakeServer{ln: ln, rejectAt: rejectAt, code: code, stall: stall, done: make(chan struct{})}
	t.Cleanup(func() { ln.Close() })
	go s.serve()
	return s
}

func (s *fakeServer) hostPort(t *testing.T) (string, int) {
	host, p, err := net.SplitHostPort(s.ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	port, _ := strconv.Atoi(p)
	return host, port
}

func (s *fakeServer) serve() {
	defer close(s.done)
	conn, err := s.ln.Accept()
	if err != nil {
		return
	}
	defer conn.Close()
	tp := textproto.NewConn(conn)
	if s.stall {
		_, _ = io.Copy(io.Discard, conn) // never greets; returns when the client closes
		return
	}
	reply := func(code int, msg string) { _ = tp.PrintfLine("%d %s", code, msg) }
	reply(220, "fake ESMTP")
	for {
		line, err := tp.ReadLine()
		if err != nil {
			return
		}
		verb := strings.ToUpper(strings.SplitN(line, " ", 2)[0])
		verb = strings.SplitN(verb, ":", 2)[0]
		if verb == s.rejectAt {
			reply(s.code, "rejected <persona@example.test> because reasons")
			continue
		}
		switch verb {
		case "EHLO", "HELO":
			_ = tp.PrintfLine("250-fake")
			reply(250, "OK")
		case "MAIL":
			s.mu.Lock()
			s.from = append(s.from, line)
			s.mu.Unlock()
			reply(250, "OK")
		case "RCPT":
			s.mu.Lock()
			s.to = append(s.to, line)
			s.mu.Unlock()
			reply(250, "OK")
		case "DATA":
			reply(354, "go ahead")
			data, err := tp.ReadDotBytes()
			if err != nil {
				return
			}
			s.mu.Lock()
			s.data = data
			s.mu.Unlock()
			reply(250, "2.0.0 Ok: queued as FAKE")
		case "RSET", "NOOP":
			reply(250, "OK")
		case "QUIT":
			reply(221, "bye")
			return
		default:
			reply(502, "unknown")
		}
	}
}

func testMessage(unsubscribe bool) email.Message {
	m := email.Message{
		To:         "persona@example.test",
		From:       `"PeopleFlow" <no-reply@peopleflow.test>`,
		Subject:    "Nueva postulación en Analista «Datos»",
		Text:       "Nueva postulación\n\nVer candidatos: https://app.peopleflow.test/empresa/vacantes/x/pipeline\n",
		HTML:       "<!DOCTYPE html>\n<html lang=\"es\"><body><h1>Nueva postulación</h1><p>línea con ñ y acentos — y una línea muy larga que supera los setenta y seis caracteres del quoted-printable sin problema</p></body></html>\n",
		MessageID:  "<11111111-1111-4111-8111-111111111111@peopleflow.test>",
		Headers:    map[string]string{"Auto-Submitted": "auto-generated"},
		DeliveryID: "11111111-1111-4111-8111-111111111111",
		Type:       "application_received",
		Template:   "application_received.one",
	}
	if unsubscribe {
		m.Headers["List-Unsubscribe"] = "<https://app.peopleflow.test/api/notificaciones/baja?token=k1.p.m>"
		m.Headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
	}
	return m
}

func send(t *testing.T, s *fakeServer, m email.Message) (string, error) {
	t.Helper()
	host, port := s.hostPort(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return New(host, port).Send(ctx, m)
}

func TestSMTPMailerSendsMultipartAlternative(t *testing.T) {
	for _, unsubscribe := range []bool{true, false} {
		s := startFakeServer(t, "", 0)
		m := testMessage(unsubscribe)
		id, err := send(t, s, m)
		if err != nil {
			t.Fatal(err)
		}
		<-s.done
		if id != m.MessageID {
			t.Fatalf("provider id %q", id)
		}
		if len(s.from) != 1 || s.from[0] != "MAIL FROM:<no-reply@peopleflow.test>" {
			t.Fatalf("MAIL %v", s.from)
		}
		if len(s.to) != 1 || s.to[0] != "RCPT TO:<persona@example.test>" {
			t.Fatalf("RCPT %v", s.to)
		}
		parsed, err := mail.ReadMessage(bytes.NewReader(s.data))
		if err != nil {
			t.Fatal(err)
		}
		h := parsed.Header
		subject, err := new(mime.WordDecoder).DecodeHeader(h.Get("Subject"))
		if err != nil || subject != m.Subject {
			t.Fatalf("subject %q (%q) err=%v", subject, h.Get("Subject"), err)
		}
		if h.Get("From") != m.From || h.Get("To") != "<persona@example.test>" || h.Get("Message-Id") != m.MessageID ||
			h.Get("Mime-Version") != "1.0" || h.Get("Auto-Submitted") != "auto-generated" || h.Get("Date") == "" {
			t.Fatalf("headers %v", h)
		}
		if unsubscribe {
			if h.Get("List-Unsubscribe") != m.Headers["List-Unsubscribe"] || h.Get("List-Unsubscribe-Post") != "List-Unsubscribe=One-Click" {
				t.Fatalf("unsubscribe headers %v", h)
			}
		} else if h.Get("List-Unsubscribe") != "" || h.Get("List-Unsubscribe-Post") != "" {
			t.Fatalf("unsubscribe headers on a mandatory mail: %v", h)
		}
		mediaType, params, err := mime.ParseMediaType(h.Get("Content-Type"))
		if err != nil || mediaType != "multipart/alternative" {
			t.Fatalf("content type %q err=%v", h.Get("Content-Type"), err)
		}
		r := multipart.NewReader(parsed.Body, params["boundary"])
		var parts []string
		var types []string
		for {
			p, err := r.NextPart() // decodes quoted-printable
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Fatal(err)
			}
			body, _ := io.ReadAll(p)
			// On the wire every line ends in CRLF.
			parts = append(parts, strings.ReplaceAll(string(body), "\r\n", "\n"))
			types = append(types, p.Header.Get("Content-Type"))
		}
		if len(parts) != 2 || types[0] != "text/plain; charset=utf-8" || types[1] != "text/html; charset=utf-8" {
			t.Fatalf("parts %v", types)
		}
		if parts[0] != m.Text || parts[1] != m.HTML {
			t.Fatalf("bodies differ\ntext %q\nhtml %q", parts[0], parts[1])
		}
		// ReadDotBytes already turned CRLF into LF.
		for _, line := range strings.Split(string(s.data), "\n") {
			if len(line) > 998 {
				t.Fatalf("line over 998 octets")
			}
		}
	}
}

// SMTP 5xx → ErrPermanent; 4xx → transient. Errors never carry the server
// text (it may echo the address).
func TestSMTPMailerClassifiesRejections(t *testing.T) {
	cases := []struct {
		at        string
		code      int
		permanent bool
	}{
		{"RCPT", 550, true},
		{"MAIL", 553, true},
		{"DATA", 554, true},
		{"RCPT", 451, false},
		{"DATA", 421, false},
	}
	for _, tc := range cases {
		s := startFakeServer(t, tc.at, tc.code)
		_, err := send(t, s, testMessage(true))
		if err == nil {
			t.Fatalf("%s %d accepted", tc.at, tc.code)
		}
		if errors.Is(err, email.ErrPermanent) != tc.permanent {
			t.Fatalf("%s %d: permanent=%v err=%v", tc.at, tc.code, errors.Is(err, email.ErrPermanent), err)
		}
		if strings.Contains(err.Error(), "persona") || strings.Contains(err.Error(), "reasons") {
			t.Fatalf("server text leaked: %v", err)
		}
	}
}

func TestSMTPMailerConnectionRefusedIsTransient(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().(*net.TCPAddr)
	ln.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = New("127.0.0.1", addr.Port).Send(ctx, testMessage(false))
	if err == nil || errors.Is(err, email.ErrPermanent) {
		t.Fatalf("err=%v", err)
	}
}

// The context bounds the whole exchange (the sender uses a 15 s timeout).
func TestSMTPMailerHonoursTheContextDeadline(t *testing.T) {
	s := startServer(t, "", 0, true)
	host, port := s.hostPort(t)
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err := New(host, port).Send(ctx, testMessage(false))
	if err == nil || errors.Is(err, email.ErrPermanent) {
		t.Fatalf("err=%v", err)
	}
	if time.Since(start) > 3*time.Second {
		t.Fatalf("deadline ignored: %v", time.Since(start))
	}
}

// Invalid addresses are permanent and nothing reaches the server; header
// values with CR/LF are refused (no header injection).
func TestSMTPMailerRefusesUnsafeMessages(t *testing.T) {
	bad := map[string]func(*email.Message){
		"to not an address": func(m *email.Message) { m.To = "nobody" },
		"to injection":      func(m *email.Message) { m.To = "a@b.test\r\nRCPT TO:<c@d.test>" },
		"from invalid":      func(m *email.Message) { m.From = "nobody" },
		"header injection":  func(m *email.Message) { m.Headers["List-Unsubscribe"] = "<https://x.test>\r\nBcc: c@d.test" },
		"message id inject": func(m *email.Message) { m.MessageID = "<a@b>\nBcc: c@d.test" },
		"header name":       func(m *email.Message) { m.Headers["Bad Name:"] = "x" },
	}
	for name, mutate := range bad {
		s := startFakeServer(t, "", 0)
		m := testMessage(true)
		m.Headers = map[string]string{"Auto-Submitted": "auto-generated", "List-Unsubscribe": "<https://x.test>"}
		mutate(&m)
		_, err := send(t, s, m)
		if err == nil {
			t.Fatalf("%s: accepted", name)
		}
		if !errors.Is(err, email.ErrPermanent) {
			t.Fatalf("%s: want permanent, got %v", name, err)
		}
		s.mu.Lock()
		got := len(s.data)
		s.mu.Unlock()
		if got != 0 {
			t.Fatalf("%s: data reached the server", name)
		}
	}
}

// Subject with CR/LF never splits the header block (the renderer collapses
// them; the adapter encodes whatever remains).
func TestSMTPMailerEncodesTheSubject(t *testing.T) {
	s := startFakeServer(t, "", 0)
	m := testMessage(false)
	m.Subject = "Hola\r\nBcc: c@d.test"
	if _, err := send(t, s, m); err != nil {
		t.Fatal(err)
	}
	<-s.done
	parsed, err := mail.ReadMessage(bufio.NewReader(bytes.NewReader(s.data)))
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Header.Get("Bcc") != "" {
		t.Fatal("subject injected a header")
	}
}
