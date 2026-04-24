{
  description = "Stoat desktop fork — multi-server switcher for self-hosted Stoat/Revolt instances";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        # Version bumped independently of upstream via the `selfhost-v*` tag.
        # Package `version` still mirrors upstream's package.json so the
        # release-asset filenames line up.
        version = "1.3.0";
        releaseTag = "selfhost-v${version}";

        # Pre-built zip published by `gh release create` on mornepousse/for-desktop.
        # The asset bundles the packaged app (app.asar + resources + the Linux
        # Electron binary from npm). We strip that Electron binary and reuse
        # the nixpkgs one instead, so the result is properly nix-ld'd and
        # has correct library paths.
        src = pkgs.fetchurl {
          url = "https://github.com/mornepousse/for-desktop/releases/download/${releaseTag}/Stoat-linux-x64-${version}.zip";
          # Populated after `gh release upload`. Replace with the real hash on
          # first update; `nix build` will print the expected value on mismatch.
          hash = "sha256-iLSDRp2wnw/UEvIV1zxicccxZYNlIlOwOseI2nPKyoQ=";
        };

        # Runtime libs the Electron binary loads via dlopen. Keep in sync with
        # the ones referenced in the devShell below — nixpkgs `electron` is
        # already wrapped for us, but a few optional libs (libnotify, libcups,
        # vulkan-loader) improve feature coverage.
        runtimeLibs = with pkgs; [
          libnotify
          cups
          vulkan-loader
          alsa-lib
        ];

        stoat-desktop = pkgs.stdenv.mkDerivation {
          pname = "stoat-desktop";
          inherit version src;

          nativeBuildInputs = with pkgs; [
            unzip
            makeWrapper
            copyDesktopItems
            imagemagick # resize icon into hicolor sizes if needed
          ];

          dontUnpack = false;

          unpackPhase = ''
            runHook preUnpack
            mkdir -p app
            unzip -q $src -d app
            runHook postUnpack
          '';

          installPhase = ''
            runHook preInstall

            # The zip extracts to ./app/Stoat-linux-x64/
            pkgDir="$(find app -maxdepth 2 -type d -name 'Stoat-linux-*' -print -quit)"
            if [ -z "$pkgDir" ]; then
              echo "error: could not locate the Stoat-linux-* directory in the release zip" >&2
              find app -maxdepth 2 >&2
              exit 1
            fi

            # Install the app payload (app.asar + unpacked native modules +
            # locales) under /opt-style, but skip the bundled Electron binary —
            # nixpkgs electron takes over at runtime.
            install -dm755 $out/share/stoat-desktop
            cp -r "$pkgDir/resources" $out/share/stoat-desktop/
            cp -r "$pkgDir/locales"   $out/share/stoat-desktop/ 2>/dev/null || true

            # Binary wrapper.
            install -dm755 $out/bin
            makeWrapper ${pkgs.electron}/bin/electron $out/bin/stoat-desktop \
              --add-flags $out/share/stoat-desktop/resources/app.asar \
              --prefix LD_LIBRARY_PATH : ${pkgs.lib.makeLibraryPath runtimeLibs}

            # Icons (hicolor) — the zip ships one PNG; we install a single size
            # and let the desktop environment scale. If the release ever ships
            # a full hicolor tree we'll iterate here.
            icon="$pkgDir/resources/app/assets/desktop/icon.png"
            if [ -f "$icon" ]; then
              install -Dm644 "$icon" $out/share/icons/hicolor/512x512/apps/stoat-desktop.png
            fi

            runHook postInstall
          '';

          desktopItems = [
            (pkgs.makeDesktopItem {
              name = "stoat-desktop";
              desktopName = "Stoat";
              comment = "Open source user-first chat platform (self-host fork)";
              exec = "stoat-desktop %U";
              icon = "stoat-desktop";
              categories = [
                "Network"
                "InstantMessaging"
              ];
              terminal = false;
              startupWMClass = "Stoat";
            })
          ];

          meta = with pkgs.lib; {
            description = "Stoat desktop client (self-host fork with multi-server switcher)";
            homepage = "https://github.com/mornepousse/for-desktop";
            license = licenses.agpl3Only;
            platforms = [ "x86_64-linux" ];
            mainProgram = "stoat-desktop";
          };
        };

        # Dev shell mirroring shell.nix at the workspace root, so contributors
        # can `nix develop` inside for-desktop/ and get node + pnpm + the libs
        # the prebuilt Electron binary from npm expects at runtime.
        electronRuntimeLibs = with pkgs; [
          glib
          nss
          nspr
          atk
          at-spi2-atk
          at-spi2-core
          cups
          libdrm
          libxkbcommon
          gtk3
          pango
          cairo
          dbus
          expat
          alsa-lib
          libgbm
          systemd
          libxcb
          xorg.libX11
          xorg.libXcomposite
          xorg.libXdamage
          xorg.libXext
          xorg.libXfixes
          xorg.libXrandr
          libxshmfence
          libnotify
          nghttp2
          stdenv.cc.cc.lib
          mesa
          vulkan-loader
        ];
      in
      {
        packages = {
          default = stoat-desktop;
          stoat-desktop = stoat-desktop;
        };

        apps.default = {
          type = "app";
          program = "${stoat-desktop}/bin/stoat-desktop";
        };

        devShells.default = pkgs.mkShell {
          nativeBuildInputs = with pkgs; [
            nodejs_22
            pnpm
            git
            python3
          ];
          buildInputs = electronRuntimeLibs;
          shellHook = ''
            echo "── stoat-fork/for-desktop dev shell ──"
            echo "node: $(node --version)  pnpm: $(pnpm --version)"
            export PNPM_HOME="$PWD/.pnpm-store"
            mkdir -p "$PNPM_HOME"
            export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath electronRuntimeLibs}''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
          '';
        };
      }
    );
}
