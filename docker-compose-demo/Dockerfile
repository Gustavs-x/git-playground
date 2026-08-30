FROM nginxinc/nginx-unprivileged:alpine

COPY --chown=nginx:nginx site/ /usr/share/nginx/html/

USER nginx
EXPOSE 8080
ENTRYPOINT ["nginx", "-g", "daemon off;"]
