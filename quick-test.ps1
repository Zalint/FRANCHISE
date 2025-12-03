# Quick test script - UPDATE THE API KEY BELOW
$apiKey = "YOUR_ACTUAL_API_KEY_HERE"  # ← Replace this with your real API key

Write-Host "🧪 Testing Stock Copy API" -ForegroundColor Cyan
Write-Host "📍 Endpoint: https://keur-bali.onrender.com/api/external/stock/copy"
Write-Host "🔑 API Key: $($apiKey.Substring(0,[Math]::Min(10,$apiKey.Length)))..."
Write-Host ""

# Test 1: Health Check
Write-Host "1️⃣ Testing Health Check..." -ForegroundColor Yellow
try {
    $headers = @{ 'X-API-Key' = $apiKey }
    $health = Invoke-RestMethod -Uri 'https://keur-bali.onrender.com/api/external/health' -Method Get -Headers $headers
    Write-Host "✅ Health Check Passed!" -ForegroundColor Green
    Write-Host "   Environment: $($health.environment)"
    Write-Host "   API Key Configured: $($health.apiKeyConfigured)"
} catch {
    Write-Host "❌ Health Check Failed: $($_.Exception.Message)" -ForegroundColor Red
    return
}

Write-Host ""

# Test 2: Dry Run
Write-Host "2️⃣ Testing Dry Run (Safe Test)..." -ForegroundColor Yellow
try {
    $headers = @{ 'Content-Type' = 'application/json'; 'X-API-Key' = $apiKey }
    $body = '{"date":"2025-08-09","dryRun":true,"override":true}'
    $result = Invoke-RestMethod -Uri 'https://keur-bali.onrender.com/api/external/stock/copy' -Method Post -Headers $headers -Body $body
    
    Write-Host "✅ Dry Run Successful!" -ForegroundColor Green
    Write-Host "   Success: $($result.success)"
    Write-Host "   Message: $($result.message)"
    Write-Host "   Date: $($result.date)"
    Write-Host "   Dry Run: $($result.dryRun)"
    if ($result.output) {
        Write-Host "   Output Preview: $($result.output.Substring(0,[Math]::Min(100,$result.output.Length)))..."
    }
} catch {
    Write-Host "❌ Dry Run Failed!" -ForegroundColor Red
    if ($_.Exception.Response) {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $errorResponse = $reader.ReadToEnd()
        Write-Host "   Error: $errorResponse" -ForegroundColor Red
    } else {
        Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "🎉 Testing Complete!" -ForegroundColor Cyan
Write-Host "   To run a production copy (not dry run), change 'dryRun':true to 'dryRun':false"
