# Sela Tugas

Aplikasi lokal untuk mencatat tugas mahasiswa dan mengingatkan tenggat dengan alarm harian. Dibangun untuk demo integrasi AI pada 18 November 2026.

## APK Android

[Unduh Sela Tugas untuk Android](downloads/SelaTugas-android-demo.apk). Buka halaman file APK, pilih Download raw file, lalu buka berkas yang diunduh dan ikuti dialog pemasangan Android. Repository privat memerlukan login GitHub.

APK demo mendukung Android 8 atau lebih baru dengan Android System WebView yang diperbarui. Tugas dan lampiran disimpan pada HP. Aktifkan Pengingat harian dan izinkan notifikasi, lalu coba suara H-3/H-2/H-1. Perekaman VN meminta izin mikrofon. Dikte memakai layanan pengenalan suara yang tersedia di HP.

Android menjadwalkan pengingat sekitar pukul 09.00 WIB, termasuk ketika layar aplikasi ditutup. Penghematan baterai dan pengaturan notifikasi perangkat dapat memengaruhi waktu serta suara. Setelah HP dihidupkan ulang, jadwal dipasang kembali. Force stop melalui pengaturan Android menangguhkan pengingat sampai aplikasi dibuka lagi.

APK memakai penyimpanan lokal tersendiri pada HP. Build awal ini ditandatangani dengan sertifikat debug untuk demo. [Petunjuk build Android](android/README.md).

## Menjalankan

Gunakan Windows dan Node.js 24 LTS. Buka file **Jalankan Sela Tugas.cmd**, lalu akses [Sela Tugas lokal](http://127.0.0.1:4317).

Perintah dari folder project juga tersedia.

```powershell
node --env-file-if-exists=.env.local server.mjs --open
```

Proses aplikasi harus tetap aktif. Tutup dengan Ctrl+C. Data SQLite dan lampiran disimpan di folder data yang dibuat saat aplikasi berjalan.

## Alur penggunaan

1. Klik Catat tugas, isi nama dan tanggal pengumpulan. Mata kuliah dan catatan bersifat opsional.
2. Tambahkan foto, rekam VN, atau lampirkan file audio. Maksimal empat lampiran, masing-masing 6 MiB.
3. Gunakan Dikte catatan untuk mengubah suara langsung menjadi teks. Browser perlu mendukung SpeechRecognition, mendapatkan izin mikrofon, dan dapat memerlukan internet.
4. Klik Simpan tugas. Dashboard mengurutkan tugas aktif berdasarkan tenggat.
5. Aktifkan sakelar Pengingat harian untuk alarm otomatis.
6. Tandai kotak tugas setelah selesai. Tugas dapat dibuka kembali melalui filter Selesai.

## Perilaku alarm

| Tahap | Pesan | Nada |
| --- | --- | --- |
| H-3 | Mulai cicil | Dua nada ringan |
| H-2 | Segera kerjakan | Tiga nada naik |
| H-1 | Urgent | Empat nada lebih tegas |

Pemeriksaan berjalan setiap 30 detik. Setelah pukul 09.00 WIB, tugas yang memasuki H-3, H-2, atau H-1 mendapat satu klaim pengingat per tahap dan tanggal tenggat. Apabila aplikasi baru dibuka sore hari, tahap yang berlaku hari itu diproses saat aplikasi aktif. Tugas selesai dan contoh demo dilewati scheduler.

Laptop perlu menyala dan terjaga, proses Node harus berjalan, dan volume perangkat perlu terdengar. Sesi yang ditutup sebelum suatu hari berakhir dapat melewatkan pengingat hari tersebut. Klaim disimpan sebelum popup dijalankan agar restart saat popup tampil menjaga pengingat dari pengulangan. Gangguan tepat setelah klaim dan sebelum popup terbuka dapat meninggalkan klaim yang perlu diperiksa pada data deliveries.

Tombol Coba suara memanggil popup desktop beserta nada contoh. Popup menutup otomatis setelah sekitar 14 detik. Contoh data tersedia melalui Isi contoh demo.

## Integrasi dan bukti

- Codex membuat project dan issue lewat Linear MCP. [Project Linear](https://linear.app/hpic-worklog-system/project/sela-tugas-697acf51a7dc)
- Source disimpan pada repo GitHub privat. Penulisan commit dilakukan lewat GitHub MCP. [Repository](https://github.com/rahmatmaul/sela-tugas)
- Project PostHog disiapkan melalui WebMCP pada halaman PostHog yang sudah login. Aplikasi mengirim event melalui HTTP Capture API. Event yang teramati mencakup task_created, task_updated, task_completed, reminder_setting_changed, dan reminder_previewed. [Aktivitas PostHog](https://eu.posthog.com/project/355013/activity/events)

Konfigurasi analitik dibaca dari variabel lingkungan POSTHOG_HOST, POSTHOG_TOKEN, dan POSTHOG_PROJECT_ID. File .env.local pada laptop demo memuat konfigurasi project. Gunakan .env.example sebagai acuan saat menyiapkan perangkat baru. Outbox SQLite menyimpan event yang belum terkirim dan mencoba kembali setiap lima detik. UUID event dipertahankan selama retry.

Event berisi nama aksi, tahap pengingat, jumlah lampiran, penanda demo, dan selisih hari tenggat. Isi teks tugas serta file foto/audio tersimpan pada perangkat.

## Pemeriksaan

```powershell
node --test
```

Pengujian mencakup CRUD, tanggal kalender, alarm per tahap, penyimpanan setelah restart, empat lampiran besar, klaim pengingat, shutdown saat pekerjaan berlangsung, dan retry analitik. Pengujian UI tambahan pada proses pengembangan menggunakan perangkat mikrofon sintetis untuk VN.

## Kelompok

| Anggota | Peran yang direncanakan |
| --- | --- |
| Maulana | Project Manager |
| Risky | Backend |
| Robby | Frontend |
| Noval | Pendamping frontend |
| Aurel | Dokumentasi dan PPT |
| Jesica | Dokumentasi dan PPT |

Implementasi awal pada sesi ini dijalankan Maulana dengan bantuan Codex. Peran kelompok di atas berasal dari pembagian yang disampaikan Maulana.

## Lingkup versi demo

Versi desktop berjalan lokal pada satu perangkat Windows. APK Android memakai penyimpanan serta pengingat native di HP. Fitur VN menyimpan rekaman dan fitur dikte mengubah suara langsung menjadi teks. Transkripsi file audio yang diunggah belum tersedia. Dikte desktop dengan suara asli serta fitur perangkat pada APK masih perlu pemeriksaan langsung pada perangkat pengguna.

## Referensi

[PostHog Capture API](https://posthog.com/docs/api/capture), [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder), [SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition).
