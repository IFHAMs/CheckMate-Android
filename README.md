# CheckMate Android — GitHub Actions build

This is a lightweight Android WebView wrapper for the live CheckMate site at https://checkmate.gt.tc/.

## Build
1. Upload the contents of this folder to the `IFHAMs/CheckMate-Android` GitHub repository (or a new repository).
2. Open **Actions → Build CheckMate APK → Run workflow**.
3. When it finishes, open the workflow run and download the **CheckMate-debug-apk** artifact.

The build runs on GitHub's hosted Linux runner, so Windows 7 is not used for compiling.

The debug APK is suitable for testing/installing on Android. It is not a Play Store release signing setup.
