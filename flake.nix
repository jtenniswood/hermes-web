{
  description = "Hermes Web — the Hermes Desktop chat UI as a browser app. Builds ONLY the web UI of hermes-agent; nothing else (no electron, no dashboard, no agent tooling).";

  # hermes-agent is a plain input (flake = false): nix fetches it into the
  # store, pinned by flake.lock. Update upstream with `nix flake update hermes`.
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    hermes = {
      url = "github:NousResearch/hermes-agent";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, flake-utils, hermes }:
    (flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        nodejs = pkgs.nodejs_24;
        pnpm = pkgs.pnpm;
        root = toString ./.;

        # Our web code only (this repo), filtered to what the build needs.
        webSrc = builtins.path {
          path = ./.;
          name = "hermes-mobile-web";
          filter = path: type:
            let
              p = toString path;
              base = baseNameOf path;
              inWeb = builtins.match ".*/apps/web-desktop(/.*)?" p != null;
              inRoot = p == root || pkgs.lib.hasPrefix "${root}/" p;
              inStore = builtins.match ".*/(dist|logs|node_modules)(/.*)?" p != null;
            in
            !inStore && (
              (type == "directory" && (inRoot || inWeb)) ||
              (type == "regular" && (inRoot || inWeb))
            ) && base != ".npmrc";
        };

        # Build tree: our web code + the upstream renderer sources (pinned
        # input) placed at the relative paths our vite config expects
        # (../desktop/src, ../shared/src).
        src = pkgs.runCommand "hermes-web-src" { } ''
          mkdir -p $out
          cp -r ${webSrc}/. $out/
          # Store paths are read-only; make the copy writable so pnpm can
          # install into it later.
          chmod -R u+w $out
          # Drop any stale apps/desktop|apps/shared skeletons the source
          # filter may carry over from a full clone, then supply the real
          # renderer sources from the pinned input.
          rm -rf $out/apps/desktop $out/apps/shared
          mkdir -p $out/apps/desktop $out/apps/shared
          cp -r ${hermes}/apps/desktop/. $out/apps/desktop/
          cp -r ${hermes}/apps/shared/src $out/apps/shared/src
        '';
      in
      {
        # `nix build .#` → result/ = the built web dist, nothing else.
        packages.default = pkgs.stdenv.mkDerivation {
          pname = "hermes-web";
          version = "0.1.1";

          inherit src;
          HERMES_WRAPPER_REV = self.rev or "dirty";
          HERMES_RELEASE_CHANNEL = "nix";
          SOURCE_DATE_EPOCH = toString (self.lastModified or 0);

          # pnpmConfigHook (nixpkgs) unpacks the FOD store tarball, rebuilds
          # the v11 index.db from the SQL dump (sqlite) and runs the offline
          # install with --trust-lockfile — the canonical pnpm 11 pattern.
          nativeBuildInputs = [ nodejs pnpm pkgs.zstd pkgs.sqlite pkgs.pnpmConfigHook ];

          # The hook's `pnpm config set` needs a writable HOME (sandbox HOME
          # is read-only /homeless-shelter).
          preConfigure = ''
            export HOME="$TMPDIR"
          '';

          # Fixed-output fetch of the pnpm dependency closure (network allowed
          # here; the build itself is offline). First build fails with the real
          # hash — paste it into pnpmDeps.hash and rebuild.
          pnpmDeps = pkgs.fetchPnpmDeps {
            pname = "hermes-web";
            version = "0.1.1";
            # v4: current fetcher for pnpm 11 (26.11+). Output is a pnpm
            # store dir (+ reproducible tarball), consumed via
            # `pnpm config set store-dir` in buildPhase.
            fetcherVersion = 4;
            inherit src;
            hash = "sha256-5nbQ3yviIjnsir+OokTvo+rMfQwvEgTuQImN/vgBY+w=";
          };

          buildPhase = ''
            runHook preBuild
            pnpm --filter web-desktop run build
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall
            mkdir -p $out
            cp -r apps/web-desktop/dist/. $out/
            runHook postInstall
          '';
        };

        # Serve the pinned static artifact with the same nginx contract as Docker.
        apps.default = {
          type = "app";
          program = "${pkgs.writeShellScript "hermes-web-serve" ''
            set -eu
            runtime_dir=$(mktemp -d)
            trap 'rm -rf "$runtime_dir"' EXIT
            mkdir -p "$runtime_dir/html"
            cp -r ${self.packages.${system}.default}/. "$runtime_dir/html/"
            chmod -R u+w "$runtime_dir/html"
            export HERMES_STATIC_ROOT="$runtime_dir/html"
            export HERMES_STATE_DIR="$runtime_dir/nginx"
            export HERMES_NGINX_CONFIG="$runtime_dir/nginx.conf"
            export HERMES_NGINX_TEMPLATE=${pkgs.writeText "hermes-nginx-template" (builtins.replaceStrings [ "/etc/nginx/mime.types" ] [ "${pkgs.nginx}/conf/mime.types" ] (builtins.readFile ./nginx.conf.template))}
            export HERMES_PORT="''${HERMES_PORT:-4174}"
            export HERMES_HOME="''${HERMES_HOME:-$HOME/.hermes}"
            ${nodejs}/bin/node ${./scripts/runtime-config.mjs}
            ${pkgs.nginx}/bin/nginx -c "$runtime_dir/nginx.conf" -g 'daemon off;'
          ''}";
        };

        # Development uses the same checked checkout as Docker and CI. Existing
        # paths are verified and never replaced, including old nix-store links.
        devShells.default = pkgs.mkShell {
          packages = [ nodejs pnpm pkgs.git ];
          shellHook = ''
            if node scripts/renderer.mjs; then
              echo "Hermes Web dev shell — verified renderer from flake.lock."
              echo "  pnpm install --frozen-lockfile && pnpm dev"
            else
              echo "Renderer preparation failed. Resolve the reported source mismatch before building."
            fi
          '';
        };
      })) // {
    # Home-manager module defining the persistent Hermes Web systemd service
    # (static hosting and the configured gateway proxy on :4174). Wiring into
    # the main nix-config:
    #   imports = [ inputs.hermes-mobile.homeManagerModules.hermes-web ];
    #   services.hermes-web.enable = true;
    homeManagerModules = {
      default = import ./modules/hermes-web.nix;
      hermes-web = import ./modules/hermes-web.nix;
    };
  };
}
