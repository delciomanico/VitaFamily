// Package db embute as migrações goose para o binário `vita migrate`.
package db

import "embed"

//go:embed migrations/*.sql
var Migrations embed.FS
