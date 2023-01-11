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
```
