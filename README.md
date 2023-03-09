# jamulus-lounge

Web-based interface to let people listen in to a Jamulus server.

## Needs

* x86_64 architecture (not arm64)
* 1 megabyte of RAM

## Run

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

## Configure

```sh
# Create configuration file
cp server/config.example.json server/config.json

# Create welcome message
echo Welcome > public/welcome.html
```
