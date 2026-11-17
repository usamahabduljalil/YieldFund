# Downloads public contract code only. No signing, credentials or transaction calls.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$rheaRpcs = @('https://rpc.mainnet.fastnear.com', 'https://archival-rpc.mainnet.fastnear.com')
$rheaBlock = '6twmEjFj4Wny7nNMvfQqLHkSJJEzL2sgNFYKJVAHcPZz'
$expectedSha = '4FD64E59A0466CF3392FF1914959C59C7C086ED82300571C6E8FC89D9F7DEDE1'
$body = @{ jsonrpc = '2.0'; id = 'yieldfund-rhea-read'; method = 'query'; params = @{
    request_type = 'view_code'; account_id = 'contract.main.burrow.near'; block_id = $rheaBlock
} } | ConvertTo-Json -Depth 5
$reply = $null
$readErrors = @()
foreach ($rheaRpc in $rheaRpcs) {
    try {
        $candidate = Invoke-RestMethod -Uri $rheaRpc -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 20
        if ($candidate.error) { throw ($candidate.error | ConvertTo-Json -Compress) }
        $reply = $candidate
        break
    } catch { $readErrors += $_.Exception.Message }
}
if ($null -eq $reply) { throw "Pinned Rhea code read failed: $($readErrors -join '; ')" }
if ($reply.result.hash -ne '6Nek1MZ8cwJJ2xMQAUWup9V5AToYS9rkTxJfwo6BCpFa') { throw 'Unexpected protocol code hash' }
$wasm = [Convert]::FromBase64String($reply.result.code_base64)
$actualSha = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($wasm))
if ($actualSha -ne $expectedSha) { throw 'Downloaded Rhea code does not match pinned SHA256' }
$artifactDirectory = Join-Path $projectRoot 'artifacts/rhea'
[IO.Directory]::CreateDirectory($artifactDirectory) | Out-Null
[IO.File]::WriteAllBytes((Join-Path $artifactDirectory 'mainnet-rhea.wasm'), $wasm)
Write-Output "Pinned public Rhea Wasm verified: $($wasm.Length) bytes; no transactions."
