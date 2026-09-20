# Serve a CI-built artifact with the same nginx contract used by Docker.
{ config, lib, pkgs, ... }:
let
  cfg = config.services.hermes-web;
  state = "${config.xdg.cacheHome}/hermes-web";
  prepare = pkgs.writeShellScript "prepare-hermes-web" ''
    set -eu
    test -f ${lib.escapeShellArg cfg.directory}/index.html
    mkdir -p ${lib.escapeShellArg state}/html
    cp -r ${lib.escapeShellArg cfg.directory}/. ${lib.escapeShellArg state}/html/
    chmod -R u+w ${lib.escapeShellArg state}/html
    ${pkgs.nodejs_24}/bin/node ${../scripts/runtime-config.mjs}
  '';
  template = pkgs.writeText "hermes-nginx-template" (
    builtins.replaceStrings [ "/etc/nginx/mime.types" ] [ "${pkgs.nginx}/conf/mime.types" ] (builtins.readFile ../nginx.conf.template)
  );
in {
  options.services.hermes-web = {
    enable = lib.mkEnableOption "Hermes Web nginx service";
    directory = lib.mkOption {
      type = lib.types.str;
      default = "${config.home.homeDirectory}/.hermes/desktop-web/current";
      description = "Directory containing the extracted CI frontend artifact (index.html and assets).";
    };
    gatewayUrl = lib.mkOption { type = lib.types.str; default = "http://127.0.0.1:9119"; description = "The single configured Hermes gateway origin."; };
    hermesHome = lib.mkOption { type = lib.types.str; default = "${config.home.homeDirectory}/.hermes"; description = "Directory containing plugin assets."; };
    host = lib.mkOption { type = lib.types.str; default = "127.0.0.1"; description = "Bind address for nginx."; };
    port = lib.mkOption { type = lib.types.port; default = 4174; description = "HTTP listening port."; };
  };
  config = lib.mkIf cfg.enable {
    systemd.user.services.hermes-web = {
      Unit = { Description = "Hermes Web"; After = [ "network.target" ]; };
      Service = {
        Environment = [
          "HERMES_GATEWAY_URL=${cfg.gatewayUrl}"
          "HERMES_HOME=${cfg.hermesHome}"
          "HERMES_STATIC_ROOT=${state}/html"
          "HERMES_STATE_DIR=${state}/nginx"
          "HERMES_NGINX_TEMPLATE=${template}"
          "HERMES_NGINX_CONFIG=${state}/nginx.conf"
          "HERMES_BIND=${cfg.host}"
          "HERMES_PORT=${toString cfg.port}"
        ];
        ExecStartPre = prepare;
        ExecStart = "${pkgs.nginx}/bin/nginx -c ${state}/nginx.conf -g 'daemon off;'";
        Restart = "on-failure";
        RestartSec = "5s";
      };
      Install.WantedBy = [ "default.target" ];
    };
  };
}
