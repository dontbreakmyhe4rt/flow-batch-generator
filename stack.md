Vỏ ứng dụng — Electron 33.4.11
Chromium + Node.js trong một tiến trình. Chia hai phần: main (Node, toàn quyền hệ thống) và renderer (giao diện, bị cô lập). Bắc cầu bằng preload.js với contextIsolation: true — renderer không đụng được require, chỉ gọi được đúng danh sách hàm tôi cho phép qua IPC.

Giao diện — HTML/CSS/JS thuần
Không React, không Vue, không bundler, không build step. Chỉ 3 file trong ui/. Với quy mô này thì framework chỉ thêm phụ thuộc và thời gian build chứ không giúp gì.

Điều khiển trình duyệt — playwright-core 1.63.0 + Chrome DevTools Protocol
Điểm mấu chốt: dùng playwright-core chứ không phải playwright, vì bản core không tải trình duyệt riêng — nó nối vào Chrome thật của bạn qua connectOverCDP. Nhờ vậy gói cài chỉ 80 MB thay vì 400+ MB, và quan trọng hơn là chạy trên Chrome thật đã đăng nhập Google, không phải Chromium lạ dễ bị Google chặn.

Lưu trữ — file JSON, không database
jobs.json (Task), profiles.json (cửa sổ Chrome), .state.json (tiến độ, đặt ngay trong thư mục ảnh). Đọc được bằng mắt, sửa được bằng Notepad, chép sang máy khác vẫn dùng được.

Đóng gói — electron-builder 25.1.8 + NSIS

Icon — build/make-icon.js tự sinh .ico bằng zlib có sẵn của Node, không cần thư viện đồ hoạ nào.