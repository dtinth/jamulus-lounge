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

## Environment variables

You can configure some more settings in a `.env` file, which is [read by Docker Compose](https://docs.docker.com/compose/environment-variables/set-environment-variables/#substitute-with-an-env-file) and [interpolated](https://docs.docker.com/compose/compose-file/12-interpolation/) into the `docker-compose.yml` file.

```sh
# .env

# IP and port of the Jamulus server (default: 127.0.0.1:22124)
JAMULUS_SERVER=

# The port to run gojam API server on (default: 9999)
GOJAM_API_PORT=

# The port to run the public-facing server on (default: 9998)
LOUNGE_SERVER_PORT=

# The port to run the admin server on (default: 9996)
LOUNGE_ADMIN_PORT=

# -- Clipper settings (see below) --
# The port to run the clipper server on (default: 9997)
LOUNGE_CLIPPER_PORT=

# The URL of the upload-endpoint server
CLIPPER_UPLOAD_URL=

# The API key for the upload-endpoint server
CLIPPER_UPLOAD_KEY=

# The key prefix for the upload-endpoint server
CLIPPER_UPLOAD_NAMESPACE=
```

## Clipper configuration (Optional)

[Clipper](https://mjth.live/clipper/) is an optional feature for `jamulus-lounge` that continuously records 10 minutes of audio. Jam participants can export the recorded audio. This is an advanced feature that is not well documented yet. To set this up, first deploy an [upload-endpoint](https://github.com/dtinth/upload-endpoint) and configure the clipper-related environment variables.

## Reverse proxy configuration

Caddyfile:

```
your.domain {
        reverse_proxy localhost:9998
}
```
