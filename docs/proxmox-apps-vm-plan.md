# Proxmox Apps VM Plan

Last updated: 2026-05-19

## Goal

Create one Proxmox VM to host miscellaneous apps under Docker Compose, including:

- CSpot
- Future accounting project
- Other small apps in development

The VM should become the tidy place for app stacks, while Nginx Proxy Manager / Tailscale Funnel remains the public ingress layer.

## Proposed VM

Name: `apps-docker`

Suggested resources:

- OS: Ubuntu Server 24.04 LTS cloud image
- CPU: 4 cores
- RAM: 8 GB
- Disk: 120 GB minimum, larger if storing recordings/media
- Network: bridge `vmbr0`
- IP: static LAN IP, likely `192.168.2.185/24`
- Gateway: likely `192.168.2.1`
- User: `chwalsh`

## Host Layout

Target layout inside the VM:

```text
/srv/apps/
  cspot/
    docker-compose.yml
    .env
    recordings/
    backups/

  accounting/
    docker-compose.yml
    .env
    data/

  shared/
    postgres-backups/
    nginx-snippets/
```

## Portainer

Install Portainer CE on the apps VM as a lightweight Docker dashboard:

- Use for logs, restarts, container shell, health checks, experiments.
- Keep Git/compose files as the source of truth for important apps.
- Prefer Tailscale-only access or NPM access-list protection.

Install command once Docker exists:

```bash
docker volume create portainer_data

docker run -d \
  --name portainer \
  --restart=unless-stopped \
  -p 9443:9443 \
  -p 9000:9000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v portainer_data:/data \
  portainer/portainer-ce:latest
```

## Proxmox Access Context

From Windows, `ssh proxmox` works.

From WSL/Codex, `ssh proxmox` currently does not resolve:

```text
Could not resolve hostname proxmox
```

Need to copy the Windows SSH config details into the WSL environment or provide the resolved Proxmox IP/user.

Useful Windows command:

```powershell
ssh -G proxmox
```

Needed lines:

```text
hostname
user
port
identityfile
```

## Creation Flow

First run only read-only discovery commands on Proxmox:

```bash
hostname
whoami
command -v qm
pvesm status
ip -br link show
qm list
```

Then confirm:

- Storage name, e.g. `local-lvm`
- Bridge name, e.g. `vmbr0`
- New VM ID
- Static IP

After confirmation, create an Ubuntu cloud-init VM with `qm`.

## VS Code Workflow

Once the VM exists:

- Use VS Code Remote SSH to connect to `apps-docker`.
- Work directly in `/srv/apps`.
- Keep each app in its own folder and compose stack.

This will be better for ongoing development and deployment than editing everything from the Proxmox shell.
