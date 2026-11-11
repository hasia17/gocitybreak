FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/ ./cmd/api ./cmd/worker

# One image, two commands: the API (default) and the price worker (/worker).
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/api /out/worker /
EXPOSE 8080
ENTRYPOINT ["/api"]
