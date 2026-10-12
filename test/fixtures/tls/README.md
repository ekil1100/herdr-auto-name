# Test-only TLS fixtures

## Purpose

`localhost-cert.pem` and `localhost-key.pem` are a self-signed certificate and
publicly committed private key for local proxy regression tests only. Never use
this key outside tests.

The certificate covers `localhost` and `127.0.0.1` and is valid from
2020-01-01 through 2120-01-01 UTC.

## Installation

No dependencies or runtime certificate generation are required.

## Configuration

`test/proxy.test.mjs` loads these files into its local HTTPS backend and trusts
the certificate only in child processes via `NODE_EXTRA_CA_CERTS`. TLS certificate
and hostname verification remain enabled.
