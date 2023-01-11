```sh
# Pull the latest images
docker compose pull

# Install server dependencies
docker compose run --rm server yarn

# Run the servers
docker compose up --detach

# Check the logs
docker compose logs --follow
```
