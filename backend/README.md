## Backend proxy server

This folder contains proxy script to be put on server with BEE Node, serving content and proxying stamps purchases for users.

```
npm install express http-proxy-middleware viem cors dotenv

```

## Config

```
cp .env.example .env
```

and change values of variables in the .env file

## Nginx and CORS (production: beeport.xyz)

Canonical copy-paste config for **https://beeport.xyz** (static site + Bee proxy + CORS for MetaMask Snaps) lives in:

**[`nginx-beeport.example.conf`](./nginx-beeport.example.conf)**

Include it from the **`http { }`** block of your main `nginx.conf` (nginx requires `map` directives in `http` context, not inside `server { }`). Alternatively, split: paste only the `map` blocks into `http`, and move the `server { }` blocks into `sites-available/beeport.xyz` if you prefer that layout.

### Why these CORS settings

1. **`Origin: null` (MetaMask Snaps)**  
   Snaps call `fetch()` from a sandboxed context; the browser often sends `Origin: null`. Browsers require the response to include `Access-Control-Allow-Origin: null` (exactly) for JS to read the body—not `*` when you also use credentials (see below).

2. **`Access-Control-Allow-Credentials: true` and no `*`**  
   The spec forbids `Access-Control-Allow-Origin: *` together with `Access-Control-Allow-Credentials: true`. We set credentials to `true` and use a **`map $http_origin $cors_origin`** to echo back only allowed origins, including the literal `"null"` string for Snaps, plus real HTTPS origins (beeport, www, buzz-mint, localhost dev).

3. **Preflight `OPTIONS`**  
   Non-simple requests (e.g. `POST /bzz` with Swarm and proxy auth headers) trigger an `OPTIONS` preflight. The `if ($request_method = 'OPTIONS')` blocks return **204** with the **same** `Allow-Origin`, `Allow-Methods`, `Allow-Headers`, and `Expose-Headers` as real responses so the browser unlocks the follow-up request.

4. **`Access-Control-Allow-Headers` superset (`$cors_allow_headers_api`)**  
   One shared list for `/bzz`, `/stamps`, `/wallet`, and `/tags` covers Bee’s Swarm headers (`swarm-postage-batch-id`, …), Beesnap proxy headers (`x-upload-signed-message`, …), `swarm-redundancy-level`, index/error document headers, and `swarm-tag`. If a header is missing here, the preflight fails with a generic browser error even though `curl` works.

5. **`/health` uses a smaller header map**  
   Read-only checks do not need the full Swarm upload header list; keeps preflight responses smaller.

6. **`Access-Control-Expose-Headers`**  
   Lets browser JS read listed response headers (e.g. session helpers). Match what your Node proxy or Bee actually returns.

### Apply and reload

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## Benefits of this layout

The beeport example uses **nginx `map` variables** so CORS headers stay DRY across `/bzz`, `/stamps`, `/wallet`, `/tags`, and matching `OPTIONS` blocks:

### ✅ **Advantages:**

- **DRY Principle**: Define headers once, use everywhere
- **Easier Maintenance**: Change headers in one place
- **Consistent**: Same headers for preflight and actual requests
- **Cleaner**: Less repetitive code

### 🔧 **How It Works:**

```nginx
# Define once at the top
map $request_method $cors_expose_headers {
    default "Content-Length,Content-Range,x-session-token,x-session-created,x-session-valid";
    OPTIONS "Content-Length,Content-Range,x-session-token,x-session-created,x-session-valid";
}

# Use everywhere
add_header 'Access-Control-Expose-Headers' $cors_expose_headers always;
```

### 📝 **To Add New Headers:**

Just update the map variables at the top - they'll automatically apply to both preflight and actual requests.

## How to apply the beeport nginx config

1. Copy or symlink [`nginx-beeport.example.conf`](./nginx-beeport.example.conf) onto the server (e.g. `/etc/nginx/snippets/beeport.conf`).
2. From **`http { }`** in `/etc/nginx/nginx.conf`, add:  
   `include /etc/nginx/snippets/beeport.conf;`  
   (Adjust the path; the file must be included inside `http`, not only inside `server`, because of the `map` blocks.)
3. Adjust `root`, `proxy_pass` ports (`3333` for the Node proxy, `1633` for Bee), and TLS paths if your layout differs.
4. Run `sudo nginx -t` and `sudo systemctl reload nginx`.

`add_header` lines for CORS—including **`Access-Control-Expose-Headers`**—must appear both on normal responses and inside each `OPTIONS` preflight block. The example file already mirrors them; if you edit one branch, keep them in sync.

## Troubleshooting CORS

1. **Snap / null origin (matches production Snaps):**

   ```bash
   curl -sI -H 'Origin: null' https://beeport.xyz/wallet | grep -i access-control
   ```

   Expect `access-control-allow-origin: null` when `$cors_origin` resolves to `null`.

2. **Browser site origin (e.g. local install page):**

   ```bash
   curl -sI -H 'Origin: http://localhost:3000' https://beeport.xyz/wallet | grep -i access-control
   ```

3. **Expose headers on `/bzz`:**

   ```bash
   curl -sI -H 'Origin: null' https://beeport.xyz/bzz | grep -i access-control-expose
   ```

4. **Temporary wide-open debugging (do not leave on in production):** you can temporarily add `Access-Control-Allow-Origin: *` **without** `Allow-Credentials: true` on a single location to confirm the problem is CORS-related—then revert.

5. **Logs:** `sudo tail -f /var/log/nginx/error.log`

6. **Reload after edits:** `sudo nginx -t && sudo systemctl reload nginx`

# Smart contract registry

We have here smart contract registry, that is used to keep track of stamps bought by user address. Deployed on Gnosis chain with Remix IDE.
