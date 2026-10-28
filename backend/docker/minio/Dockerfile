# MinIO is AGPL-3.0: local development/integration only, not shipped with the API.
# Source/toolchain pinned from the release's go.mod (go 1.24.0, go1.24.8).
FROM golang:1.24.8-alpine3.22 AS builder
RUN apk add --no-cache git
WORKDIR /src
RUN git clone --depth 1 --branch RELEASE.2025-10-15T17-29-55Z \
      https://github.com/minio/minio.git . && \
    test "$(git rev-parse HEAD)" = \
      "9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a"
RUN CGO_ENABLED=0 go build -trimpath -o /out/minio .

FROM alpine:3.22.2 AS runtime
RUN apk add --no-cache ca-certificates && \
    addgroup -g 10001 minio && \
    adduser -D -u 10001 -G minio minio && \
    mkdir /data && chown minio:minio /data
COPY --from=builder /out/minio /usr/local/bin/minio
USER 10001:10001
VOLUME /data
EXPOSE 9000 9001
HEALTHCHECK --interval=5s --timeout=3s --start-period=30s --retries=12 \
    CMD wget -q -O /dev/null http://127.0.0.1:9000/minio/health/live || exit 1
ENTRYPOINT ["/usr/local/bin/minio"]
CMD ["server", "/data", "--console-address", ":9001"]
