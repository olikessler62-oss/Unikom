# Testzertifikate

Selbst signiertes Zertifikat für `localhost` (`127.0.0.1`), ausschließlich für
den FTPS-Testserver in [../FtpsTestServer.ts](../FtpsTestServer.ts).

**Der private Schlüssel hier ist öffentlich und wertlos.** Er schützt nichts,
liegt absichtlich im Repository und darf niemals in einer echten Umgebung
verwendet werden. Der Produktivbuild schließt dieses Verzeichnis aus
(siehe `tsconfig.build.json`).

Neu erzeugen:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 36500 \
  -keyout test-key.pem -out test-cert.pem \
  -subj "//CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```
