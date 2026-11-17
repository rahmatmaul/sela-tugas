# Sela Tugas Android

Project native Java memuat UI pada assets WebView dengan origin HTTPS lokal. SQLite menyimpan tugas, foto, dan VN di perangkat. AlarmManager menjadwalkan notifikasi H-3, H-2, dan H-1 berdasarkan kalender Asia/Jakarta. Tiga channel notifikasi memakai nada berbeda.

## Build

Gunakan JDK 17 dan Android SDK platform 35 serta Build Tools 35.0.0. Gradle Wrapper menggunakan versi 8.11.1.

Dari folder android, jalankan perintah berikut.

```powershell
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

Pada Linux atau macOS, jalankan wrapper melalui sh.

```sh
sh gradlew testDebugUnitTest lintDebug assembleDebug
```

APK tersedia di app/build/outputs/apk/debug/app-debug.apk. Pengaturan SDK lokal dibaca dari ANDROID_HOME atau local.properties. Task prepareWebAssets mengambil UI dari folder public pada root repository, sehingga perubahan tampilan ikut masuk dalam build.

Konfigurasi PostHog opsional dibaca dari .env.local pada root project saat build. Public project token dimasukkan ke assets APK untuk ingestion event. Source aplikasi memakai nama variabel lingkungan, dan .env.local masuk gitignore.

## Penggunaan

1. Unduh APK dari folder downloads pada repository, lalu pasang melalui dialog Android.
2. Buka Sela Tugas, catat tugas, dan pilih tanggal pengumpulan.
3. Aktifkan Pengingat harian dan berikan izin notifikasi.
4. Coba suara untuk memeriksa channel notifikasi H-3/H-2/H-1.
5. Gunakan Rekam VN untuk merekam sampai 60 detik, dan izinkan mikrofon saat diminta.

Pilihan foto dan audio menggunakan pemilih file Android. Dikte memakai RecognizerIntent untuk layanan pengenalan suara pada perangkat. Jika layanan tersebut belum tersedia, aplikasi menampilkan pesan dan catatan tetap dapat diketik.

## Perilaku pengingat

Alarm menggunakan setAndAllowWhileIdle agar dapat diproses saat aplikasi tertutup dan perangkat idle. Android dapat menggeser waktu karena mode hemat baterai. Jadwal dipasang kembali setelah boot dan perubahan waktu. Tugas selesai serta data contoh dilewati. Satu klaim pengingat disimpan untuk setiap tugas, tanggal tenggat, dan tahap.

Force stop dari pengaturan Android menghentikan penerimaan alarm sampai aplikasi dibuka lagi. Channel notifikasi serta volume dikelola Android dan dapat diubah oleh pengguna.

## Verifikasi

Pengujian unit memeriksa cutoff pukul 09.00 WIB, tahap H-3/H-2/H-1, dan pergantian bulan/tahun. Build menjalankan Android lint dan menghasilkan APK bertanda tangan debug. Pemeriksaan pada HP fisik masih diperlukan untuk mikrofon, pemilih file, layanan dikte, serta pengiriman notifikasi dalam pengaturan baterai perangkat.

[Dokumentasi AlarmManager](https://developer.android.com/reference/android/app/AlarmManager), [konten lokal WebView](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content), [izin notifikasi](https://developer.android.com/develop/ui/views/notifications/time-sensitive).
