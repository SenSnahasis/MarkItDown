# Static site, zero backend — nginx just serves the files as-is.
FROM nginx:alpine

COPY index.html style.css favicon.svg /usr/share/nginx/html/
COPY js/ /usr/share/nginx/html/js/

EXPOSE 80
