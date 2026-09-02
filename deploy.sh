#!/bin/bash

# Exit on error
set -e

# Configuration
IMAGE_NAME="transia/debugstream"
VERSION="${1:-latest}"

echo "Building Docker image: ${IMAGE_NAME}:${VERSION} for linux/amd64"
echo "Building from Mac, targeting Linux servers..."

# Build and push for linux/amd64 platform (common server architecture)
# Using --push to push directly to registry (required for cross-platform builds)
docker buildx build --platform linux/amd64 \
  -t ${IMAGE_NAME}:${VERSION} \
  --push \
  .

# Also tag and push as latest if a specific version was provided
if [ "$VERSION" != "latest" ]; then
    echo "Also tagging and pushing as latest..."
    docker buildx build --platform linux/amd64 \
      -t ${IMAGE_NAME}:latest \
      --push \
      .
fi

echo "Successfully built and pushed ${IMAGE_NAME}:${VERSION} for linux/amd64"
echo ""
echo "To run the container on your Linux server:"
echo "docker pull ${IMAGE_NAME}:${VERSION}"
echo "docker run -d -p 3000:3000 --name debugstream ${IMAGE_NAME}:${VERSION}"