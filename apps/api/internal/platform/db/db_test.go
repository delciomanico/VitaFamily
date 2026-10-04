package db

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
)

type fakeTx struct {
	pgx.Tx
	commits, rollbacks int
	commitErr          error
}

func (f *fakeTx) Commit(context.Context) error   { f.commits++; return f.commitErr }
func (f *fakeTx) Rollback(context.Context) error { f.rollbacks++; return nil }

type fakeBeginner struct {
	tx  *fakeTx
	err error
}

func (f fakeBeginner) Begin(context.Context) (pgx.Tx, error) { return f.tx, f.err }

func TestInTx(t *testing.T) {
	boom := errors.New("boom")
	cases := []struct {
		name               string
		fn                 func(pgx.Tx) error
		commitErr          error
		wantErr            error
		commits, rollbacks int
	}{
		{"commit", func(pgx.Tx) error { return nil }, nil, nil, 1, 0},
		{"rollback em erro", func(pgx.Tx) error { return boom }, nil, boom, 0, 1},
		{"erro de commit", func(pgx.Tx) error { return nil }, boom, boom, 1, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			tx := &fakeTx{commitErr: c.commitErr}
			err := InTx(context.Background(), fakeBeginner{tx: tx}, c.fn)
			if !errors.Is(err, c.wantErr) && !(err == nil && c.wantErr == nil) {
				t.Fatalf("err=%v", err)
			}
			if tx.commits != c.commits || tx.rollbacks != c.rollbacks {
				t.Fatalf("commits=%d rollbacks=%d", tx.commits, tx.rollbacks)
			}
		})
	}
}

func TestInTxPanicRollsBack(t *testing.T) {
	tx := &fakeTx{}
	defer func() {
		if recover() == nil || tx.rollbacks != 1 {
			t.Fatal("pânico deve fazer rollback e propagar")
		}
	}()
	_ = InTx(context.Background(), fakeBeginner{tx: tx}, func(pgx.Tx) error { panic("x") })
}

func TestInTxBeginError(t *testing.T) {
	boom := errors.New("down")
	if err := InTx(context.Background(), fakeBeginner{err: boom}, nil); !errors.Is(err, boom) {
		t.Fatal(err)
	}
}
