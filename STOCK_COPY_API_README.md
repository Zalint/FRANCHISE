# Stock Copy API Documentation

## Overview

The Stock Copy API allows you to trigger the automated stock copy process via HTTP requests. This API executes the same script as the cron job (`scripts/copy-stock-cron.js`) but provides on-demand execution with real-time feedback.

## Authentication

All requests require an API key for security.

**Headers:**
- `X-API-Key: your-api-key` 
- OR `Authorization: Bearer your-api-key`

**API Key:** Set in environment variable `EXTERNAL_API_KEY`

## Endpoint

```
POST /api/external/stock/copy
```

## Request Body

```json
{
  "date": "2025-08-09",        // Optional: YYYY-MM-DD format, defaults to yesterday
  "dryRun": false,             // Optional: true for testing, false for execution
  "override": true             // Optional: override existing files
}
```

## Response Format

### Success Response (200)
```json
{
  "success": true,
  "message": "Stock copy executed successfully",
  "exitCode": 0,
  "output": "Script execution logs...",
  "dryRun": false,
  "date": "2025-08-09",
  "timestamp": "2025-08-10T01:15:30.000Z"
}
```

### Error Response (500)
```json
{
  "success": false,
  "error": "Stock copy script failed",
  "exitCode": 1,
  "output": "Script output...",
  "errorOutput": "Error logs...",
  "timestamp": "2025-08-10T01:15:30.000Z"
}
```

### Authentication Error (401)
```json
{
  "success": false,
  "error": "Unauthorized: Invalid or missing API key"
}
```

## Usage Examples

### 1. cURL Examples

**Dry Run Test:**
```bash
curl -X POST https://keur-bali.onrender.com/api/external/stock/copy \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "date": "2025-08-09",
    "dryRun": true
  }'
```

**Production Execution:**
```bash
curl -X POST https://keur-bali.onrender.com/api/external/stock/copy \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "date": "2025-08-09",
    "dryRun": false
  }'
```

**Auto-detect Date:**
```bash
curl -X POST https://keur-bali.onrender.com/api/external/stock/copy \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "dryRun": false
  }'
```

### 2. JavaScript/Node.js Example

```javascript
const response = await fetch('https://keur-bali.onrender.com/api/stock/copy', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'your-api-key'
  },
  body: JSON.stringify({
    date: '2025-08-09',
    dryRun: false
  })
});

const result = await response.json();
console.log(result);
```

### 3. Python Example

```python
import requests

response = requests.post(
    'https://keur-bali.onrender.com/api/external/stock/copy',
    headers={
        'Content-Type': 'application/json',
        'X-API-Key': 'your-api-key'
    },
    json={
        'date': '2025-08-09',
        'dryRun': False
    }
)

result = response.json()
print(result)
```

## Test Script

Use the included test script for local testing:

```bash
# Test with dry run
node test-api.js --dry-run --date=2025-08-09

# Test production execution
node test-api.js --date=2025-08-09 --production

# Test with auto-detected date
node test-api.js --dry-run
```

## Environment Variables

Ensure these are set in your deployment:

```bash
EXTERNAL_API_KEY=mata-stock-copy-2025-secure-key
NODE_ENV=production
LOG_LEVEL=info
DATA_PATH=./data/by-date
```

## Security Notes

- ✅ API key authentication required
- ✅ Input validation for date format
- ✅ Execution runs in isolated process
- ✅ Real-time output logging
- ✅ Comprehensive error handling

## Integration with Cron

This API complements the automatic cron job:
- **Cron:** Automatic daily execution at 5:00 AM UTC
- **API:** On-demand execution for testing or manual runs

## Monitoring

The API provides detailed logs and execution feedback:
- Real-time script output
- Exit codes and error messages
- Timestamps for audit trails
- Dry-run capabilities for safe testing
