#!/bin/bash

# Start Dockerd in the background
dockerd &

# Set variables
IMAGE_NAME="node22"
DOCKERFILE_PATH="."
GHCR_USERNAME="dpgraham"

# Build the Docker image
echo "Building Docker image..."
docker build -t $IMAGE_NAME -f $DOCKERFILE_PATH/Dockerfile .

# Log in to GHCR
echo "Logging in to GHCR..."
echo $GHCR_PASSWORD | docker login ghcr.io -u $GHCR_USERNAME --password-stdin

# Publish the Docker image to GHCR
echo "Publishing Docker image to GHCR..."
docker tag $IMAGE_NAME ghcr.io/$GHCR_USERNAME/$IMAGE_NAME:fake
docker push ghcr.io/$GHCR_USERNAME/$IMAGE_NAME:fake

echo "Docker image published successfully!"
