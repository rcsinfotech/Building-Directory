# Building Directory

Lobby directory sign: a Node/Express app on a Raspberry Pi inside an NEC commercial display.
A full-screen browser on the Pi shows `http://localhost:8080/`; the admin page edits tenants,
colors, building photo and the info box.

Signs in service:

| Sign | Address | Raspberry Pi Connect name |
|---|---|---|
| The Arbors | 7400 Baymeadows Way, Jacksonville FL 32256 | Arbor Signage |
| Southpoint | 4215 Southpoint Blvd, Jacksonville FL 32216 | Southpoint Signage |

## What lives where

Everything in git is shared code. Each sign keeps its own data in files git ignores, so pulling
an update never changes tenants, passwords, photos or styling.

| Path | In git? | What it is |
|---|---|---|
| `server.js`, `views/`, `public/css/styles.css`, `public/js/` | yes | The app |
| `sites/<sign>/site.css` | yes | Reference copy of each sign's style overrides |
| `data/directory.json` | no | Tenants, colors, info box (edited from the admin page) |
| `data/admin.json` | no | Admin username + password hash |
| `data/.jwt-secret` | no | Per-sign login secret, created automatically on first start |
| `certs/` | no | Self-signed HTTPS cert for the admin page (port 8443) |
| `public/images/` | no | Uploaded building photo |
| `public/css/site.css` | no | This sign's style overrides, loaded after `styles.css` if present |

Southpoint uses larger tenant rows and info text; that lives in its `public/css/site.css`
(copy of `sites/southpoint/site.css`). Arbor has no overrides.

## Ports

- `8080` public display (and what the Cloudflare tunnel serves)
- `8443` HTTPS admin, only if `certs/server.key` and `certs/server.cert` exist

## Display auto-fit

`views/display.ejs` measures the tenant list after it renders. If it doesn't fit, it shrinks the
text and spacing as little as needed; below 75% it switches to two, then three columns. The
current choice is on `<ul class="tenant-list" data-fit="...">`. Tuning constants are at the top
of the script in `display.ejs`.

## Passwords

Passwords are stored as bcrypt hashes in `data/admin.json`. A file that still has a plain-text
password keeps working: it is converted to a hash on the first successful login. Changing the
password from the admin page requires at least 8 characters.

To reset a forgotten password on a sign, set it back to plain text and log in once:

```
cd ~/<app folder>
node -e "const f='data/admin.json',fs=require('fs');const a=JSON.parse(fs.readFileSync(f));a.password=process.argv[1];fs.writeFileSync(f,JSON.stringify(a,null,2))" 'TempPass123'
```

## Updating a sign

On the sign, from the app folder:

```
./deploy/update.sh
```

It fetches `main`, fast-forwards, runs `npm ci` only if `package-lock.json` changed, restarts the
`building-directory` service and prints the log if it fails to come back. It refuses to update if
someone edited tracked files on the sign; put per-sign styling in `public/css/site.css` instead.

To roll back: `git log --oneline`, then `git checkout <commit>` and
`sudo systemctl restart building-directory`. Return with `git checkout main`.

## Setting up a new sign (or converting an existing one)

1. **Back up**: `tar czf ~/directory-backup-$(date +%F).tgz -C ~/<app folder> .`
2. **Deploy key** (read-only access for this sign):
   ```
   ssh-keygen -t ed25519 -N '' -C "$(hostname) directory sign" -f ~/.ssh/directory_deploy
   cat ~/.ssh/directory_deploy.pub
   ```
   Add the printed key in GitHub, repo **Settings, Deploy keys**, with write access off. Then:
   ```
   cat >> ~/.ssh/config <<'EOF'
   Host github-directory
     HostName github.com
     User git
     IdentityFile ~/.ssh/directory_deploy
     IdentitiesOnly yes
   EOF
   ssh -T github-directory   # answer yes; expect "successfully authenticated"
   ```
3. **Turn the app folder into a checkout** (keeps `data/`, `certs/`, `public/images/`):
   ```
   cd ~/<app folder>
   git init -q -b main
   git remote add origin git@github-directory:rcsinfotech/building-directory.git
   git fetch origin
   git checkout -f -B main origin/main
   ```
   For Southpoint, also: `cp sites/southpoint/site.css public/css/site.css`
4. **Service**: stop whatever started the app before, then `./deploy/install-service.sh`.
