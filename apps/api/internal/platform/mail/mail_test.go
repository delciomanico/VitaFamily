package mail

import (
	"context"
	"testing"
)

func TestMemory(t *testing.T) {
	var m Mailer
	mem := &Memory{}
	m = mem
	if err := m.Send(context.Background(), Message{To: "a@b.pt", Subject: "s", Text: "t"}); err != nil {
		t.Fatal(err)
	}
	if got := mem.Sent(); len(got) != 1 || got[0].To != "a@b.pt" {
		t.Fatalf("got %+v", got)
	}
}

func TestNewSMTP(t *testing.T) {
	if _, err := NewSMTP("smtp://mailhog:1025", "no-reply@x.pt"); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{"", "http://x", "smtp://", "smtp://h:abc"} {
		if _, err := NewSMTP(bad, "f"); err == nil {
			t.Errorf("%q deveria falhar", bad)
		}
	}
}
