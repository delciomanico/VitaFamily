# syntax=docker/dockerfile:1
FROM golang:1.27-alpine AS build
WORKDIR /src
ENV CGO_ENABLED=0 GOFLAGS=-buildvcs=false
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -trimpath -ldflags="-s -w" -o /out/vita ./cmd/vita

# Imagem final mínima, sem shell, utilizador não-root.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/vita /usr/local/bin/vita
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/vita"]
CMD ["api"]
