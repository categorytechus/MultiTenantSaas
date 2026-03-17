#!/bin/bash
set -e

# Install basic tools
apt-get update
apt-get install -y jq unzip postgresql-client curl git

# Install Go
curl -fL https://go.dev/dl/go1.24.0.linux-amd64.tar.gz | tar -C /usr/local -xz
export PATH=$PATH:/usr/local/go/bin
export HOME=/root
export GOPATH=/root/go
export GOMODCACHE=/root/go/pkg/mod

# Build ecr-credential-provider matching version
git clone --depth=1 --branch ${ecr_provider_version} \
  https://github.com/kubernetes/cloud-provider-aws.git /tmp/cloud-provider-aws
cd /tmp/cloud-provider-aws
go build -o /usr/local/bin/ecr-credential-provider ./cmd/ecr-credential-provider/
chmod +x /usr/local/bin/ecr-credential-provider
rm -rf /tmp/cloud-provider-aws
cd /

# Configure Credential Provider
mkdir -p /etc/rancher/k3s/
cat > /etc/rancher/k3s/credential-provider-config.yaml <<EOC
apiVersion: kubelet.config.k8s.io/v1
kind: CredentialProviderConfig
providers:
  - name: ecr-credential-provider
    matchImages:
      - "*.dkr.ecr.*.amazonaws.com"
    defaultCacheDuration: "12h"
    apiVersion: credentialprovider.kubelet.k8s.io/v1
EOC

# Configure K3s to use the provider
mkdir -p /etc/rancher/k3s/config.yaml.d/
cat > /etc/rancher/k3s/config.yaml.d/ecr.yaml <<EOC
kubelet-arg:
- "image-credential-provider-bin-dir=/usr/local/bin"
- "image-credential-provider-config=/etc/rancher/k3s/credential-provider-config.yaml"
EOC

# Install K3s
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION="${k3s_version}" sh -
sudo chmod 644 /etc/rancher/k3s/k3s.yaml
