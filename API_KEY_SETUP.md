# ZCombinator API Key Setup

## Overview

The ZCombinator ICO purchase endpoints require API key authentication to prevent unauthorized access and abuse.

## Protected Endpoints

The following endpoints require the `X-API-Key` header:

- `POST /ico/:tokenAddress/purchase/prepare`
- `POST /ico/:tokenAddress/purchase/confirm`

## Configuration

### 1. Generate an API Key

Generate a secure random API key:

```bash
# Using OpenSSL
openssl rand -hex 32

# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Set Environment Variable

Add to your `.env` file:

```bash
# ZCombinator API Key (keep this secret!)
ZC_API_KEY=your_generated_api_key_here
```

### 3. Share with Authorized Clients

Securely share the API key with authorized clients (e.g., Bangit team):

**Bangit Backend `.env`:**
```bash
ZC_API_KEY=your_generated_api_key_here
```

## Usage

### Authenticated Request Example

```typescript
import axios from 'axios';

const response = await axios.post(
  'http://localhost:6770/ico/TOKEN_ADDRESS/purchase/prepare',
  {
    wallet: 'WALLET_ADDRESS',
    solAmount: '100000000' // lamports
  },
  {
    headers: {
      'X-API-Key': process.env.ZC_API_KEY
    }
  }
);
```

### Response Codes

- `200` - Success
- `401` - Unauthorized (missing or invalid API key)
- `500` - API key not configured on server

## Security Notes

1. **Never commit API keys to git** - Use `.env` files
2. **Rotate keys periodically** - Generate new keys every 3-6 months
3. **Use different keys per environment** - Dev/staging/production should have different keys
4. **Monitor usage** - Check logs for unauthorized access attempts
5. **Revoke if compromised** - Generate new key immediately if leaked

## Public Endpoints (No API Key Required)

These endpoints remain public:

- `GET /ico/:tokenAddress` - View sale information
- `GET /ico/:tokenAddress/claim?wallet=xxx` - View claim information

## Troubleshooting

### Error: "Unauthorized - Invalid or missing API key"

- Check that `X-API-Key` header is included
- Verify the API key matches on both client and server
- Ensure no extra whitespace in the key

### Error: "API authentication not configured"

- Set `ZC_API_KEY` in your `.env` file on the server
- Restart the server after adding the environment variable

## For Bangit Team

Add this to your `bangit-backend/.env`:

```bash
# ZCombinator API credentials
ZC_ICO_API_URL=http://localhost:6770
ZC_API_KEY=<key_will_be_provided_securely>
```

The key will be provided through a secure channel (not email/Slack).
