# dAPI Management Frontend

This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Running the frontend as a Signer

You only need to run:

```bash
yarn frontend:prod
```

Open [http://localhost:3000](http://localhost:3000) with your browser to use the app.

**PLEASE NOTE**: To reflect new code changes, you will need to terminate the process (`ctrl`+`c`) and run the `yarn frontend:prod` command again.

This command will:

- install dependencies (`yarn install`)
- build the app (`yarn frontend:build`)
- start the app (`yarn frontend:start`)

## Getting started as a Developer

First, run the development server:

```bash
yarn frontend:dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `pages/index.tsx`. The page auto-updates as you edit the file.

The `pages/api` directory is mapped to `/api/*`. Files in this directory are treated as [API routes](https://nextjs.org/docs/api-routes/introduction) instead of React pages.

### Running e2e (Cypress) tests

Before running the Cypress tests, you will need to have:

- Hardhat running (`yarn run node`)
- the frontend running with required env variables (`yarn cypress:frontend:prod` or `yarn cypress:frontend:dev`)

Now you can either open Cypress to run the tests in an interactive manner:

```bash
yarn cypress:open
```

Or you can run the tests via command line:

```bash
yarn cypress:run
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!
