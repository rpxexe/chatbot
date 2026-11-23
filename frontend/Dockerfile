FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Both are baked in at build time: the /api proxy target, and the Clerk key the browser uses (empty = admin token sign-in).
ARG API_URL=http://backend:4000
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
ENV API_URL=$API_URL NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
RUN npm run build
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["npm", "start"]
