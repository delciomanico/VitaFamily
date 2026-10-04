// Package mail define o envio de e-mail atrás de interface (SMTP em produção, Mailhog em dev).
package mail

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"sync"

	gomail "github.com/wneessen/go-mail"
)

// Message é um e-mail de texto simples. Não colocar dados de saúde no conteúdo (privacy.md).
type Message struct {
	To      string
	Subject string
	Text    string
}

// Mailer envia e-mails.
type Mailer interface {
	Send(ctx context.Context, m Message) error
}

// Memory guarda as mensagens enviadas (testes).
type Memory struct {
	mu   sync.Mutex
	sent []Message
}

func (m *Memory) Send(_ context.Context, msg Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sent = append(m.sent, msg)
	return nil
}

// Sent devolve uma cópia das mensagens enviadas.
func (m *Memory) Sent() []Message {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]Message(nil), m.sent...)
}

// SMTP envia via servidor SMTP (go-mail). URL: smtp://[user:pass@]host:port (sem TLS obrigatório
// quando o utilizador não é indicado, p.ex. Mailhog) ou smtps://... .
type SMTP struct {
	host   string
	port   int
	user   string
	pass   string
	from   string
	secure bool
}

func NewSMTP(rawURL, from string) (*SMTP, error) {
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "smtp" && u.Scheme != "smtps") || u.Hostname() == "" {
		return nil, fmt.Errorf("mail: SMTP_URL inválido")
	}
	port := 25
	if p := u.Port(); p != "" {
		if port, err = strconv.Atoi(p); err != nil {
			return nil, fmt.Errorf("mail: porta inválida")
		}
	}
	s := &SMTP{host: u.Hostname(), port: port, from: from, secure: u.Scheme == "smtps"}
	if u.User != nil {
		s.user = u.User.Username()
		s.pass, _ = u.User.Password()
	}
	return s, nil
}

func (s *SMTP) Send(ctx context.Context, m Message) error {
	msg := gomail.NewMsg()
	if err := msg.From(s.from); err != nil {
		return err
	}
	if err := msg.To(m.To); err != nil {
		return err
	}
	msg.Subject(m.Subject)
	msg.SetBodyString(gomail.TypeTextPlain, m.Text)
	opts := []gomail.Option{gomail.WithPort(s.port)}
	switch {
	case s.secure:
		opts = append(opts, gomail.WithSSL())
	case s.user != "":
		opts = append(opts, gomail.WithTLSPolicy(gomail.TLSMandatory))
	default:
		opts = append(opts, gomail.WithTLSPolicy(gomail.NoTLS))
	}
	if s.user != "" {
		opts = append(opts, gomail.WithSMTPAuth(gomail.SMTPAuthAutoDiscover), gomail.WithUsername(s.user), gomail.WithPassword(s.pass))
	}
	c, err := gomail.NewClient(s.host, opts...)
	if err != nil {
		return err
	}
	return c.DialAndSendWithContext(ctx, msg)
}
