package localbootstrap

import (
	"bufio"
	"errors"
	"os"
	"strings"
	"unicode"
)

// Terminal is the private interactive approval channel. It is the only output
// channel allowed to display the verified email (S2).
type Terminal interface {
	IsInteractive() bool
	ShowPrompt(prompt string) error
	ReadLine() (string, error)
}

// OperatorDecision is the parsed operator decision.
type OperatorDecision int

// Operator decisions.
const (
	DecisionInvalid OperatorDecision = iota
	DecisionApprove
	DecisionReject
)

// ParseOperatorLine parses exactly `approve <operation_code>` or `reject`.
// Anything else (extra tokens, wrong case, shell metacharacters) is invalid.
func ParseOperatorLine(line string) (OperatorDecision, string) {
	fields := strings.Fields(line)
	switch {
	case len(fields) == 1 && fields[0] == "reject":
		return DecisionReject, ""
	case len(fields) == 2 && fields[0] == "approve":
		return DecisionApprove, fields[1]
	default:
		return DecisionInvalid, ""
	}
}

// maxDisplayRunes bounds a displayed value so the private prompt cannot be
// flooded with an oversized attribute.
const maxDisplayRunes = 512

// SanitizeForTerminal removes control characters and replaces line breaks with
// spaces so the private prompt cannot emit terminal-control payloads or inject
// extra lines.
func SanitizeForTerminal(s string) string {
	var b strings.Builder
	count := 0
	for _, r := range s {
		if count >= maxDisplayRunes {
			break
		}
		switch {
		case r == '\n' || r == '\r' || r == '\t':
			b.WriteRune(' ')
		case unicode.IsControl(r):
			// dropped
		default:
			b.WriteRune(r)
		}
		count++
	}
	return b.String()
}

// ApprovalPrompt renders the private approval prompt. It shows only the fields
// authorized by L4 §5 / S2: the verified email, the public issuer, the
// recruiter user type, the actual local database host/name, the users-only
// scope and the operation code. The full name and subject are never shown.
func ApprovalPrompt(cand Candidate, issuer string) string {
	var b strings.Builder
	b.WriteString("=== TMP-IDENTITY-001 local identity bootstrap approval ===\n")
	b.WriteString("verified email : ")
	b.WriteString(SanitizeForTerminal(cand.Email))
	b.WriteString("\n")
	b.WriteString("issuer         : ")
	b.WriteString(SanitizeForTerminal(issuer))
	b.WriteString("\n")
	b.WriteString("user type      : ")
	b.WriteString(SanitizeForTerminal(cand.UserType.String()))
	b.WriteString("\n")
	b.WriteString("scope          : users-only\n")
	b.WriteString("database       : ")
	b.WriteString(SanitizeForTerminal(cand.Database.Display()))
	b.WriteString("\n")
	b.WriteString("operation code : ")
	b.WriteString(SanitizeForTerminal(cand.OperationCode))
	b.WriteString("\n")
	b.WriteString(`Type "approve <operation code>" to authorize exactly one recruiter user creation, or "reject" to cancel.`)
	b.WriteString("\n")
	return b.String()
}

// FileTerminal is the production private-terminal implementation backed by
// /dev/tty, so piped or /dev/null stdin can never approve an operation.
type FileTerminal struct {
	file   *os.File
	reader *bufio.Reader
}

// OpenTerminal opens the controlling terminal. It fails when no controlling
// terminal is attached (piped stdin, /dev/null, CI), which is what makes an
// unattended approval impossible.
func OpenTerminal() (*FileTerminal, error) {
	file, err := os.OpenFile("/dev/tty", os.O_RDWR, 0)
	if err != nil {
		return nil, errors.New("local bootstrap: no interactive terminal is attached")
	}
	return &FileTerminal{file: file, reader: bufio.NewReader(file)}, nil
}

// IsInteractive reports whether a real controlling terminal is attached.
func (t *FileTerminal) IsInteractive() bool {
	return t != nil && t.file != nil
}

// ShowPrompt writes the prompt to the private terminal.
func (t *FileTerminal) ShowPrompt(prompt string) error {
	if !t.IsInteractive() {
		return errors.New("local bootstrap: terminal is not interactive")
	}
	_, err := t.file.WriteString(prompt)
	return err
}

// ReadLine reads exactly one operator line from the private terminal.
func (t *FileTerminal) ReadLine() (string, error) {
	if !t.IsInteractive() {
		return "", errors.New("local bootstrap: terminal is not interactive")
	}
	line, err := t.reader.ReadString('\n')
	if err != nil && line == "" {
		return "", err
	}
	return strings.TrimRight(line, "\r\n"), nil
}

// Close releases the private terminal handle.
func (t *FileTerminal) Close() error {
	if t == nil || t.file == nil {
		return nil
	}
	return t.file.Close()
}
