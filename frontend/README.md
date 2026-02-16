This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Configuration

### Changing the Port Number

By default, the Next.js app runs on port **3000**. You can change this in several ways:

#### Option 1: Command Line (Temporary)
```bash
npm run dev -- -p 3001
```

#### Option 2: Environment Variable
Create or update `.env.local`:
```bash
PORT=3001
```

Then run:
```bash
npm run dev
```

#### Option 3: Update package.json (Permanent)
Edit `package.json`:
```json
{
  "scripts": {
    "dev": "next dev -p 3001"
  }
}
```

### Environment Variables

The following environment variables can be configured in `.env.local`:
```bash
# Port (optional, default: 3000)
PORT=3000

# Cognito Configuration (required for auth)
NEXT_PUBLIC_USER_POOL_ID=your-user-pool-id
NEXT_PUBLIC_USER_POOL_CLIENT_ID=your-client-id
NEXT_PUBLIC_COGNITO_DOMAIN=your-cognito-domain
NEXT_PUBLIC_REDIRECT_SIGN_IN=http://localhost:3000/auth/callback
NEXT_PUBLIC_REDIRECT_SIGN_OUT=http://localhost:3000
```

**Note:** After changing the port, update the redirect URLs in your environment variables and auth configuration.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
