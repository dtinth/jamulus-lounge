# jamulus-lounge

Web-based interface to let people listen in to a Jamulus server.

## Running

```sh
# Pull the latest images
docker compose pull

# Install server dependencies
docker compose run --rm server yarn

# Run the servers
docker compose up --detach

# Check the logs
docker compose logs --follow

# Restart server
docker compose restart server
```

## Configuration

```sh
# Create configuration file
cp server/config.example.json server/config.json

# Create welcome message
echo Welcome > public/welcome.html
```

## Clipper configuration

Deploy an [upload-endpoint](https://github.com/dtinth/upload-endpoint) and configure as follows:

```yaml
# docker-compose.override.yml
services:
  clipper:
    env_file: .env
```

```sh
CLIPPER_UPLOAD_URL=
CLIPPER_UPLOAD_KEY=
```

## Reverse proxy configuration

Caddyfile:

```
your.domain {
        reverse_proxy localhost:9998
}
```
