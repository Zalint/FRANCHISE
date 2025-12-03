$uri = "https://keur-bali.onrender.com/api/external/stock/copy"
$headers = @{
    'Content-Type' = 'application/json'
    'X-API-Key' = 'mata-stock-copy-2025-secure-key'
}

# Use raw JSON string to avoid PowerShell conversion issues
$jsonBody = '{"date":"2025-08-09","dryRun":true,"override":true}'

Write-Host "Testing with raw JSON: $jsonBody"

try {
    $response = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $jsonBody
    Write-Host "✅ Success!" -ForegroundColor Green
    $response | ConvertTo-Json -Depth 10
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $statusCode = $_.Exception.Response.StatusCode
        Write-Host "Status Code: $statusCode" -ForegroundColor Red
        
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $responseText = $reader.ReadToEnd()
        Write-Host "Response: $responseText" -ForegroundColor Red
    }
}
