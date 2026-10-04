package main

import (
	"context"
	"errors"
)

// runCreatePlatformAdmin é um esqueleto: a tabela `users` e a auditoria chegam no M1.
func runCreatePlatformAdmin(_ context.Context, _ []string) error {
	return errors.New("create-platform-admin ainda não implementado (M1: requer users e audit)")
}
