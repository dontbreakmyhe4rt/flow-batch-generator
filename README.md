# Flow Batch Generator

Tool desktop tự động tạo ảnh hàng loạt trên [Google Flow](https://flow.google.com)
từ một file `config.json`, tải ảnh về thư mục chỉ định và đổi tên theo `file_name`.

## Cài đặt

```bash
npm install     # đã chạy sẵn
```

Yêu cầu: Node.js 18+, Google Chrome, tài khoản Google có quyền dùng Flow.

## Chạy

```bash
npm start
```

### Nhiều Task chạy song song

App chia làm hai phần: **sidebar** bên trái và **panel của Task đang chọn** bên phải.

```
┌── TRÌNH DUYỆT (dùng chung) ──┬─ Task đang chọn ──── [↺ Đặt lại] [✕ Xoá Task] ─┐
│ ● Chrome 1     9222 · 3 tab  │  ĐẦU VÀO (config, thư mục, tab sẽ dùng)        │
│ ● Chrome 2     9223 · 1 tab  │  THAM SỐ FLOW                                 │
│ [+ Cửa sổ] [↻ Làm mới]       │  NÂNG CAO                                     │
├── TASK ──────────────────────┤  [▶][↻][⏸][■]  tiến độ                        │
│ 1 sanpham   ✓ 12/12  Chrome1 │  DANH SÁCH │ LOG                              │
│ 2 banner    ⏳ 5/20   Chrome1 │                                               │
│ 3 poster    ✗ 2 lỗi  Chrome2 │                                               │
│ [+ Thêm Task] [🗑 Xoá hết]   │                                               │
└──────────────────────────────┴───────────────────────────────────────────────┘
```

Mỗi **Task** có config, thư mục lưu, tab Flow và bộ tham số riêng — hoàn toàn độc lập.
Bấm Bắt đầu ở Task nào thì Task đó chạy ngay, **không chờ Task khác**. Sidebar hiện tiến
độ của mọi Task cùng lúc nên không phải bấm qua lại để theo dõi.

Thao tác với Task:

| Nút | Việc nó làm |
|---|---|
| **+ Thêm Task** | thêm Task mới, tên mặc định `Task 1`, `Task 2`… |
| **✕** trên mỗi hàng | xoá riêng Task đó (hiện khi rê chuột vào hàng) |
| **🗑 Xoá hết** | xoá toàn bộ, để lại một Task trống — có hộp thoại xác nhận |
| **↺ Đặt lại** | đưa Task đang mở về mặc định: bỏ config, thư mục, tab và mọi tham số |
| **✕ Xoá Task** | xoá Task đang mở |

Xoá hết và Đặt lại đều **không đụng tới ảnh đã tải hay file config trên đĩa**, và đều bị
chặn khi còn Task đang chạy.

- **Chọn Config JSON thì thư mục lưu tự điền** bằng chính thư mục chứa file config đó.
  Bạn chọn lại được, và khi đã chọn tay thì lần sau đổi config sẽ không bị đè.
- **Tên Task** mặc định là `Task 1`, `Task 2`… Khi chọn config/thư mục thì tự đổi theo thư mục lưu. Thư mục tên chung chung (`out`, `output`,
  `images`…) thì lấy tên thư mục cha — `D:\sanpham\out` thành `sanpham`. Trùng tên thì
  tự thêm `_2`. Bấm vào tên trên đầu panel để đổi; đã đặt tay thì không bị tự đổi nữa.
- **Một tab chỉ thuộc về một Task.** Tab đã giao cho Task khác hiện **mờ và không chọn
  được**, kèm `— đã giao cho "…"`. Muốn nhường thì bỏ chọn ở Task kia trước. Ràng buộc
  này được kiểm tra cả ở `jobs.update` lẫn lúc bấm Bắt đầu.
- Nhiều Task có thể dùng **chung một profile** (khác tab) hoặc **khác profile** để chạy
  song song trên nhiều tài khoản Google.
- Thoát app khi còn Task đang chạy sẽ có hộp thoại xác nhận.

Danh sách Task lưu ở `jobs.json`. Nếu bạn dùng bản cũ, `settings.json` được tự chuyển
thành Task đầu tiên.

### Nhiều cửa sổ, nhiều tài khoản Google

Mục **Trình duyệt** quản lý nhiều *cửa sổ Chrome độc lập*. Mỗi cửa sổ là một profile riêng
(`profiles/<id>/`) với **cổng debug riêng** và **phiên đăng nhập Google riêng** — dùng để
chạy nhiều tài khoản song song.

Mặc định có sẵn 2 cửa sổ (`Chrome 1` cổng 9222, `Chrome 2` cổng 9223). Bấm **+ Thêm cửa sổ**
để có thêm (tối đa 8, cổng 9222–9229). Bấm vào tên để đổi — nên đặt theo email cho dễ nhớ.

### Lần đầu

1. Ở dòng cửa sổ bạn muốn, bấm **Mở** — Chrome bật lên với profile riêng của nó.
2. Trong cửa sổ vừa mở: **đăng nhập Google**, rồi **mở project Flow**
   (URL dạng `flow.google.com/project/<id>`).
3. Làm tương tự cho cửa sổ thứ hai với tài khoản khác, nếu cần.
4. Về app bấm **↻ Làm mới danh sách**, rồi chọn tab ở ô **Tab sẽ dùng** —
   dropdown nhóm theo từng cửa sổ, `✓` là tab đã ở trong project, `•` là ở Flow nhưng chưa vào project.
5. Bấm **▶ Bắt đầu**.

Từ lần sau phiên đăng nhập được giữ nguyên — chỉ cần bấm Mở, vào project rồi Bắt đầu.
Nút **↗ Hiện** đưa cửa sổ Chrome tương ứng lên trước. Nút **✕** chỉ xoá khỏi danh sách,
dữ liệu đăng nhập trong `profiles/<id>/` vẫn còn.

### Về việc chọn tab

Tab được ghi nhớ theo **CDP targetId** — mã định danh sống suốt đời của tab — chứ không
theo URL. Nên bạn chọn tab trước, điều hướng nó đi đâu tùy ý, tool vẫn bám đúng tab đó.

Ngoài các profile của tool, danh sách còn quét cổng `9222`–`9229` nên thấy được bất kỳ
Chrome nào bạn tự mở kèm `--remote-debugging-port` (hiện dưới nhóm *"Chrome ngoài"*).
Nếu không chọn tab nào, tool quay về chế độ tự dò: tìm tab đang mở `flow.google.com/project/...`.

> **Chrome thường của bạn không xuất hiện trong danh sách.** Từ Chrome 136, Google bỏ qua
> `--remote-debugging-port` khi `user-data-dir` là thư mục mặc định, nên không có cách nào
> điều khiển cửa sổ Chrome bạn đang dùng hằng ngày. Đó là lý do mỗi cửa sổ trong tool phải
> là một profile riêng và phải đăng nhập lại một lần.


## Đóng gói ra file .exe

```bash
npm run dist            # ra cả bản cài và bản portable
npm run dist:installer  # chỉ bản cài NSIS
npm run dist:portable   # chỉ bản portable
npm run icon            # vẽ lại build/icon.ico
```

Kết quả trong `dist/`:

| File | Dùng khi |
|---|---|
| `Flow Batch Generator-1.0.0-Setup.exe` (~80 MB) | cài đặt bình thường, có shortcut Desktop + Start Menu, có mục gỡ cài |
| `Flow Batch Generator-1.0.0-Portable.exe` (~80 MB) | chép sang máy khác chạy thẳng, không cần cài |

### Máy đích cần gì

Chỉ cần **Google Chrome**. Tool điều khiển Chrome thật nên không có Chrome là không chạy
được — `findChrome()` dò `%PROGRAMFILES%`, `%PROGRAMFILES(X86)%`, `%LOCALAPPDATA%` rồi tra
Windows Registry, không thấy thì báo lỗi kèm link tải. Không cần cài Node.js.

Lần đầu mở, Windows sẽ hiện **"Windows protected your PC"** vì file chưa ký số — bấm
*More info → Run anyway*. Muốn hết cảnh báo phải mua chứng chỉ ký code (~$200–400/năm).

### Dữ liệu người dùng nằm ở đâu

```
%APPDATA%\flow-batch-generator\
├─ jobs.json          danh sách Task
├─ profiles.json      danh sách cửa sổ Chrome
└─ profiles\p1, p2…   dữ liệu đăng nhập Google của từng cửa sổ
```

Đây là điểm **bắt buộc** phải làm đúng: sau khi đóng gói, mã nguồn nằm trong `app.asar`
và **chỉ đọc**. `main.js` tách riêng hai đường dẫn:

```js
const APP_DIR  = __dirname;                                  // đọc: preload.js, ui/
const DATA_DIR = app.isPackaged ? app.getPath('userData')    // ghi: jobs.json, profiles/
                                : __dirname;
```

Chạy từ mã nguồn (`npm start`) thì `DATA_DIR` vẫn là thư mục dự án, nên bản dev và bản cài
có dữ liệu **tách biệt** — đăng nhập ở bản này không dùng được cho bản kia.

Gỡ cài đặt **không xoá** `%APPDATA%`, nên cài lại vẫn còn nguyên Task và phiên đăng nhập.

### Nếu build lỗi "Cannot create symbolic link"

electron-builder tải gói `winCodeSign` có chứa symlink của macOS; tạo symlink trên Windows
cần quyền admin. Ta không ký số nên chỉ cần mồi sẵn cache, giải nén **không kèm cờ symlink**:

```bash
CACHE="$LOCALAPPDATA/electron-builder/Cache/winCodeSign"
node_modules/7zip-bin/win/x64/7za.exe x -bd -y "$CACHE/<file>.7z" -o"$CACHE/winCodeSign-2.6.0"
```

Cách khác: bật Developer Mode trong Windows Settings, hoặc chạy build với quyền admin.

## File config

```json
[
  { "file_name": "img1", "prompt": "a red fox in snow, golden hour" },
  { "file_name": "img2", "prompt": "isometric cozy coffee shop, pastel" }
]
```

- `file_name` — tên file (không cần đuôi), không được trùng nhau và không chứa `\ / : * ? " < > |`
- `prompt` — nội dung nhập vào ô "What do you want to create?"

Đuôi file lấy theo đúng file Flow trả về (hiện là `.jpg`).

## Tham số trên giao diện

| Nhóm | Lựa chọn |
|---|---|
| Model | Nano Banana Pro · Nano Banana 2 · Nano Banana 2 Lite |
| Độ phân giải tải về | 1K Original size · 2K Upscaled · 4K Upscaled |
| Tỉ lệ khung hình | 16:9 · 4:3 · 1:1 · 3:4 · 9:16 |
| Số ảnh mỗi prompt | x1 · x2 · x3 · x4 |
| Nâng cao | nghỉ giữa các prompt, timeout chờ ảnh, số lần thử lại, xử lý khi trùng tên file |

Với **x2 trở lên**, ảnh thứ hai trở đi lưu thành `<file_name>_2`, `<file_name>_3`…

Mỗi Task giữ bộ tham số riêng, ghi trong `jobs.json`; lần mở sau không phải chọn lại.

## Cách tool bám đúng ảnh (mapping)

Mỗi ảnh Flow tạo ra mang một `data-media-id` (UUID) trên thẻ `<img>`. Tool dùng
**hai điều kiện phải cùng thoả** để biết chính xác ảnh nào thuộc prompt nào:

1. **Chưa từng tồn tại trước đó.** Đầu mỗi lô, tool quét toàn bộ media-id đang có
   trong project (`collectAllMediaIds`). Lưới ảnh của Flow dùng
   `cdk-virtual-scroll-viewport` — chỉ tile trong tầm nhìn mới có trong DOM — nên phải
   **cuộn hết lưới** mới lấy đủ. Nếu chỉ chụp một lần, ảnh cũ chưa render sẽ bị hiểu
   nhầm là ảnh mới khi nó trở lại DOM giữa chừng. Quét một lần cho cả lô; media-id sinh
   ra sau đó được cộng dồn vào danh sách này.

2. **Được chính lệnh Generate xác nhận.** Response POST của lệnh Generate
   (`/_/AiSandboxAngularFrontend/data/batchexecute`) chứa thẳng media-id của ảnh sắp
   tạo. Tool nghe response đó (`startMediaCapture`) và **bắt buộc** ảnh phải nằm trong
   danh sách này — đây không phải bộ lọc tuỳ chọn.

Điều kiện 2 loại được ảnh lạ chen vào (bạn tự tạo trong cùng tab, hoặc chế độ Agent tự
sinh). Điều kiện 1 loại được ảnh cũ vừa render lại.

**Khi không chắc, tool dừng chứ không đoán.** Cả ba trường hợp dưới đây đều ném lỗi rõ
ràng thay vì lưu file: nhiều ảnh được xác nhận hơn số cần; có ảnh mới nhưng không đọc
được media-id từ response; không ra ảnh nào.

Việc tải cũng truy theo media-id (`flow-tile-container:has(img[data-media-id="…"])`),
không theo vị trí trong lưới. Các media-id được ghi vào `.state.json` để đối chiếu sau.

> Dù vậy, **đừng tạo ảnh thủ công trong tab mà tool đang điều khiển.** Tool sẽ dừng với
> lỗi rõ ràng chứ không lưu sai tên, nhưng item đó vẫn hỏng.

## Trạng thái, resume và retry

Mỗi lần chạy, tool ghi `<thư mục lưu>/.state.json`:

```json
{
  "items": {
    "img1": { "status": "done",   "file": "...", "attempts": 1 },
    "img2": { "status": "failed", "error": "Qua 180s ma anh chua tao xong.", "attempts": 3 }
  }
}
```

- **▶ Bắt đầu** — bỏ qua item đã `done`, chỉ chạy phần còn lại (không tốn credit thừa).
- **↻ Chạy lại item lỗi** — chỉ chạy lại những item `failed`.
- **Chạy lại từ đầu** (checkbox) — chạy lại toàn bộ, kể cả item đã xong và item đã có file.
- Mỗi item tự thử lại theo số lần đã đặt (mặc định 2) trước khi bị đánh dấu `failed`.

### File đã có sẵn trong thư mục lưu

Ngoài `.state.json`, tool còn **đối chiếu với file thật trên đĩa**. Item nào đã có file
`<file_name>.<đuôi ảnh>` trong thư mục lưu thì mang trạng thái **⊙ đã tồn tại** và không
chạy lại — kể cả khi `.state.json` bị xoá hoặc bạn chép thư mục từ máy khác sang.

- So khớp không phân biệt hoa/thường và không phụ thuộc đuôi file: `IMG3.PNG` tính là `img3`.
- Với x2–x4 chỉ xét **file đầu tiên**: có `img1.jpg` là bỏ qua, không cần `img1_2`, `img1_3`.
- Ảnh phụ không bị nhầm thành ảnh chính: `img2_2.jpg` **không** làm `img2` bị coi là đã có.
- Muốn tạo lại thì xoá file đi, hoặc tích **Chạy lại từ đầu**.

## Cấu trúc mã nguồn

```
main.js                 Electron main: cửa sổ, IPC, dialog chọn file/thư mục
preload.js              cầu nối an toàn renderer ↔ main (contextIsolation)
src/config.js           đọc + validate config.json, settings.json, .state.json
src/profiles.js         quản lý nhiều profile Chrome (thư mục + cổng debug riêng)
src/chrome-launcher.js  bật chrome.exe theo profile + CDP, liệt kê tab, bám tab theo targetId
src/flow-driver.js      ⭐ mọi selector của trang Flow nằm ở đây
src/runner.js           vòng lặp batch: prompt → generate → chờ → tải → đổi tên
src/jobs.js             danh sách Task (jobs.json) + tên mặc định, đặt lại, xoá hết
ui/                     giao diện (index.html, style.css, renderer.js)
build/make-icon.js      vẽ icon.ico, không cần thư viện ngoài
```

### Khi Google đổi giao diện Flow

Chỉ cần sửa khối `SELECTORS` ở đầu `src/flow-driver.js`. Các selector hiện dùng
(khảo sát ngày 2026-09-07, Flow là app Angular với tên element ổn định):

| Việc | Selector |
|---|---|
| Ô nhập prompt | `flow-rich-text-editor .ProseMirror` (ProseMirror, đặt nội dung bằng `execCommand('insertText')`) |
| Nút tạo ảnh | `button.generate-icon-button` — bị `disabled` cả khi prompt rỗng lẫn khi đang tạo |
| Mở panel tham số | `button.settings-trigger-button` → `flow-prompt-box-settings` |
| Chế độ / tỉ lệ / số ảnh | các nhóm `flow-toggles`, nhận diện qua **nội dung** (xem dưới) |
| Chọn model | `flow-prompt-box-settings button[aria-haspopup="menu"]:not([role="radio"])` |
| Đang tạo | có `flow-pending-tile` trong DOM |
| Ảnh đã xong | `flow-tile-container` — **ảnh mới nhất nằm ở index 0** |
| Tải về | hover tile → `button[aria-haspopup="menu"]` → mục có icon `download` → submenu `1K`/`2K`/`4K` |

### ⚠ Không bao giờ dùng nhãn chữ để tìm phần tử

Giao diện Flow **được dịch theo ngôn ngữ trình duyệt** — `aria-label="Mode"` thành
`"Chế độ"`, `"Download"` thành `"Tải xuống"`. Selector dựa vào chữ tiếng Anh sẽ chết
ngay trên máy cài ngôn ngữ khác. `flow-driver.js` chỉ dựa vào những thứ không bị dịch:

- **tên class / custom element** — `.generate-icon-button`, `flow-toggles`
- **tên ligature của Material icon** — `image`, `videocam`, `crop_16_9`, `download`,
  `more_vert` (luôn là tiếng Anh, nằm trong `<mat-icon>`)
- **thuộc tính** — `aria-haspopup="menu"`, `role="radio"`, `aria-checked`
- **nhãn thuần số/ký hiệu** — `16:9`, `x1`, `1K`

Nhờ vậy nhóm toggle được nhận diện bằng nội dung chứ không bằng `aria-label`:
nhóm chứa icon `image` + `videocam` là *Chế độ*; nhóm mà mọi nhãn khớp `\d+:\d+` là
*Tỉ lệ*; nhóm mà mọi nhãn khớp `^x[1-4]$` là *Số ảnh*.

Danh sách model **khác nhau giữa chế độ Image và Video**, nên `applySettings()` luôn đặt
chế độ Image trước rồi mới chọn model. Nếu model trong cấu hình không có, tool báo lỗi kèm
danh sách model thật; bấm **↻ đọc từ trang** cạnh ô Model để nạp đúng danh sách của tài khoản bạn.
