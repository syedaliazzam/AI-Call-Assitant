# File: apps/desktop/scripts/store-ci-check.ps1
# Purpose: Checks the Microsoft Store (MSIX/AppX) package on a GitHub Actions Windows runner
#          (Day 6, the no-purchase alternative to code signing; docs/deploy/microsoft-store.md):
#          1. makes a throwaway self-signed test certificate whose subject matches the
#             placeholder publisher in electron-builder.yml (never stored, gone with the runner);
#          2. builds and signs the package with it, trusts it on the runner, installs it;
#          3. starts Kite through its Store app id (package identity, as the Store starts it) and
#             checks that Kite.exe runs from the package and stays up;
#          4. writes KITE_INSTALLED_EXE for the next step, which runs the desktop smoke test
#             against the installed package's Kite.exe.
# Used by: .github/workflows/ci.yml (job desktop-store, manual runs only)
# Architecture: docs/architecture/kite-architecture-v3.1.md §10 (installation); ADR-0028
#
# Runs as administrator on the runner (Add-AppxPackage and the machine certificate store need
# it). Never run it on a developer laptop: it trusts a test certificate machine-wide.

$ErrorActionPreference = 'Stop'
$publisher = 'CN=00000000-0000-0000-0000-000000000000'
$pfx = Join-Path $env:RUNNER_TEMP 'kite-store-test.pfx'
# A random one-time password: the certificate exists only for this job.
$password = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))

# 1. The test certificate (code signing), exported for electron-builder.
$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $publisher `
  -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddDays(2)
$secure = ConvertTo-SecureString $password -AsPlainText -Force
Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $secure | Out-Null

# 2. Build and sign the package; trust the certificate for installing; install.
$env:CSC_LINK = $pfx
$env:CSC_KEY_PASSWORD = $password
pnpm --filter desktop dist:store
if ($LASTEXITCODE -ne 0) { throw "dist:store failed ($LASTEXITCODE)" }
$appx = Get-ChildItem apps/desktop/release/*.appx | Select-Object -First 1
Write-Host "Package: $($appx.Name), $($appx.Length) bytes"
Import-Certificate -FilePath (Export-Certificate -Cert $cert -FilePath (Join-Path $env:RUNNER_TEMP 'kite-store-test.cer')).FullName `
  -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null
Add-AppxPackage -Path $appx.FullName
$package = Get-AppxPackage -Name 'ParamountIntelligence.Kite'
if (-not $package) { throw 'The package did not install' }
Write-Host "Installed: $($package.PackageFullName)"

# 3. Start Kite as the Store would (by app id), and check it runs from the package.
Start-Process "shell:AppsFolder\$($package.PackageFamilyName)!Kite"
Start-Sleep -Seconds 20
$running = Get-Process -Name Kite -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$($package.InstallLocation)*" }
if (-not $running) { throw 'Kite did not start from the package (by app id)' }
Write-Host "Started by app id: $($running.Count) Kite processes from the package"
$running | Stop-Process -Force
Start-Sleep -Seconds 3

# 4. The smoke test runs next, against the packaged Kite.exe.
$exe = Join-Path $package.InstallLocation 'app\Kite.exe'
if (-not (Test-Path $exe)) { $exe = Join-Path $package.InstallLocation 'Kite.exe' }
"KITE_INSTALLED_EXE=$exe" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
Write-Host "Smoke test target: $exe"
