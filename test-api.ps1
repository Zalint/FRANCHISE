# PowerShell script to test the Stock Copy API

$apiUrl = "https://keur-bali.onrender.com/api/external/stock/copy"
$apiKey = "mata-stock-copy-2025-secure-key"

$headers = @{
    'Content-Type' = 'application/json'
    'X-API-Key' = $apiKey
}

$bodyObject = @{
    date = "2025-08-09"
    dryRun = $true
    override = $true
}

$body = $bodyObject | ConvertTo-Json -Compress

Write-Host "🧪 Testing Stock Copy API"
Write-Host "📍 URL: $apiUrl"
Write-Host "🔐 API Key: $($apiKey.Substring(0,10))..."
Write-Host "📋 Body: $body"
Write-Host "─" * 50

try {
    $response = Invoke-RestMethod -Uri $apiUrl -Method Post -Headers $headers -Body $body
    Write-Host "✅ Success!" -ForegroundColor Green
    Write-Host "Response:" -ForegroundColor Green
    $response | ConvertTo-Json -Depth 10 | Write-Host
} catch {
    Write-Host "❌ Error!" -ForegroundColor Red
    Write-Host "Status: $($_.Exception.Response.StatusCode)" -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response Body:" -ForegroundColor Red
        Write-Host $responseBody -ForegroundColor Red
    }
    
    Write-Host "Exception Details:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
}
