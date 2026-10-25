// 插件开发支持库——Windows 实现。
// 让易语言程序成为 ycIDE 的可执行文件插件（设计稿 §4.1、§13.1 第 1 条）：
// 程序由 IDE 启动，经标准输入输出收发 JSON-RPC 2.0 消息，按 Content-Length 头分帧。
// 握手（initialize）、激活（plugin/activate）、停用、退出由本库自动应答，
// 易语言代码只需循环「插件_等待请求」→ 处理 →「插件_回复」。
//
// 对外 ABI（供转译器生成的 main.cpp 调用；文本参数为 UTF-8，文本返回值用 8 槽轮转缓冲持有）：
//   const char* ycplugin_WaitRequest()
//   int         ycplugin_GetArgCount()
//   const char* ycplugin_GetArg(int index)
//   void        ycplugin_Reply(const char* result)
//   void        ycplugin_ReplyError(const char* message)
//   void        ycplugin_ShowMessage(const char* text, const char* type)
//   void        ycplugin_Output(const char* text)
//   const char* ycplugin_ExecuteCommand(const char* command, const char* arg)
//   const char* ycplugin_GetLastError()
//   const char* ycplugin_GetPluginId()
//   const char* ycplugin_GetStoragePath()

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <string>
#include <vector>
#include <deque>
#include <utility>
#include <cstdlib>
#include <cstring>

namespace {

// ---------------------------------------------------------------------------
// 最小 JSON：解析与序列化（只用于协议消息）
// ---------------------------------------------------------------------------
struct Json {
    enum Kind { Null, Bool, Number, String, Array, Object } kind = Null;
    bool boolean = false;
    std::string text;  // Number：原样数字文本；String：UTF-8 内容
    std::vector<Json> items;
    std::vector<std::pair<std::string, Json>> fields;

    const Json* get(const char* key) const {
        if (kind != Object) return nullptr;
        for (const auto& f : fields) if (f.first == key) return &f.second;
        return nullptr;
    }
    std::string str(const char* key) const {
        const Json* v = get(key);
        return v && v->kind == String ? v->text : std::string();
    }
};

class Parser {
public:
    explicit Parser(const std::string& s) : s_(s) {}
    bool parse(Json& out) {
        skip();
        if (!value(out)) return false;
        skip();
        return i_ == s_.size();
    }

private:
    const std::string& s_;
    size_t i_ = 0;

    void skip() { while (i_ < s_.size() && (s_[i_] == ' ' || s_[i_] == '\t' || s_[i_] == '\r' || s_[i_] == '\n')) ++i_; }
    bool lit(const char* w) {
        size_t n = strlen(w);
        if (s_.compare(i_, n, w) != 0) return false;
        i_ += n;
        return true;
    }
    static void appendUtf8(std::string& out, unsigned cp) {
        if (cp < 0x80) out += static_cast<char>(cp);
        else if (cp < 0x800) { out += static_cast<char>(0xC0 | (cp >> 6)); out += static_cast<char>(0x80 | (cp & 0x3F)); }
        else if (cp < 0x10000) { out += static_cast<char>(0xE0 | (cp >> 12)); out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F)); out += static_cast<char>(0x80 | (cp & 0x3F)); }
        else { out += static_cast<char>(0xF0 | (cp >> 18)); out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F)); out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F)); out += static_cast<char>(0x80 | (cp & 0x3F)); }
    }
    bool hex4(unsigned& v) {
        if (i_ + 4 > s_.size()) return false;
        v = 0;
        for (int k = 0; k < 4; ++k) {
            char c = s_[i_++];
            v <<= 4;
            if (c >= '0' && c <= '9') v |= c - '0';
            else if (c >= 'a' && c <= 'f') v |= c - 'a' + 10;
            else if (c >= 'A' && c <= 'F') v |= c - 'A' + 10;
            else return false;
        }
        return true;
    }
    bool string(std::string& out) {
        if (i_ >= s_.size() || s_[i_] != '"') return false;
        ++i_;
        while (i_ < s_.size()) {
            char c = s_[i_++];
            if (c == '"') return true;
            if (c != '\\') { out += c; continue; }
            if (i_ >= s_.size()) return false;
            char e = s_[i_++];
            switch (e) {
                case '"': out += '"'; break;
                case '\\': out += '\\'; break;
                case '/': out += '/'; break;
                case 'b': out += '\b'; break;
                case 'f': out += '\f'; break;
                case 'n': out += '\n'; break;
                case 'r': out += '\r'; break;
                case 't': out += '\t'; break;
                case 'u': {
                    unsigned cp;
                    if (!hex4(cp)) return false;
                    if (cp >= 0xD800 && cp <= 0xDBFF && i_ + 6 <= s_.size() && s_[i_] == '\\' && s_[i_ + 1] == 'u') {
                        i_ += 2;
                        unsigned lo;
                        if (!hex4(lo)) return false;
                        cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                    }
                    appendUtf8(out, cp);
                    break;
                }
                default: return false;
            }
        }
        return false;
    }
    bool value(Json& v) {
        if (i_ >= s_.size()) return false;
        char c = s_[i_];
        if (c == '{') {
            v.kind = Json::Object;
            ++i_; skip();
            if (i_ < s_.size() && s_[i_] == '}') { ++i_; return true; }
            for (;;) {
                skip();
                std::string key;
                if (!string(key)) return false;
                skip();
                if (i_ >= s_.size() || s_[i_] != ':') return false;
                ++i_; skip();
                Json item;
                if (!value(item)) return false;
                v.fields.emplace_back(std::move(key), std::move(item));
                skip();
                if (i_ < s_.size() && s_[i_] == ',') { ++i_; continue; }
                if (i_ < s_.size() && s_[i_] == '}') { ++i_; return true; }
                return false;
            }
        }
        if (c == '[') {
            v.kind = Json::Array;
            ++i_; skip();
            if (i_ < s_.size() && s_[i_] == ']') { ++i_; return true; }
            for (;;) {
                skip();
                Json item;
                if (!value(item)) return false;
                v.items.push_back(std::move(item));
                skip();
                if (i_ < s_.size() && s_[i_] == ',') { ++i_; continue; }
                if (i_ < s_.size() && s_[i_] == ']') { ++i_; return true; }
                return false;
            }
        }
        if (c == '"') { v.kind = Json::String; return string(v.text); }
        if (lit("true")) { v.kind = Json::Bool; v.boolean = true; return true; }
        if (lit("false")) { v.kind = Json::Bool; v.boolean = false; return true; }
        if (lit("null")) { v.kind = Json::Null; return true; }
        size_t start = i_;
        while (i_ < s_.size() && (strchr("+-.eE", s_[i_]) || (s_[i_] >= '0' && s_[i_] <= '9'))) ++i_;
        if (i_ == start) return false;
        v.kind = Json::Number;
        v.text = s_.substr(start, i_ - start);
        return true;
    }
};

void writeString(std::string& out, const std::string& s) {
    static const char* hex = "0123456789abcdef";
    out += '"';
    for (unsigned char c : s) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) { out += "\\u00"; out += hex[c >> 4]; out += hex[c & 0xF]; }
                else out += static_cast<char>(c);
        }
    }
    out += '"';
}

void serialize(std::string& out, const Json& v) {
    switch (v.kind) {
        case Json::Null: out += "null"; break;
        case Json::Bool: out += v.boolean ? "true" : "false"; break;
        case Json::Number: out += v.text; break;
        case Json::String: writeString(out, v.text); break;
        case Json::Array:
            out += '[';
            for (size_t k = 0; k < v.items.size(); ++k) { if (k) out += ','; serialize(out, v.items[k]); }
            out += ']';
            break;
        case Json::Object:
            out += '{';
            for (size_t k = 0; k < v.fields.size(); ++k) {
                if (k) out += ',';
                writeString(out, v.fields[k].first);
                out += ':';
                serialize(out, v.fields[k].second);
            }
            out += '}';
            break;
    }
}

std::string toText(const Json& v) {
    if (v.kind == Json::String) return v.text;
    std::string out;
    serialize(out, v);
    return out;
}

std::string quoted(const std::string& s) {
    std::string out;
    writeString(out, s);
    return out;
}

// ---------------------------------------------------------------------------
// 分帧收发
// ---------------------------------------------------------------------------
std::string g_inBuf;
bool g_eof = false;

bool readMore() {
    if (g_eof) return false;
    char chunk[4096];
    DWORD got = 0;
    if (!ReadFile(GetStdHandle(STD_INPUT_HANDLE), chunk, sizeof(chunk), &got, NULL) || got == 0) {
        g_eof = true;
        return false;
    }
    g_inBuf.append(chunk, got);
    return true;
}

/** 读一条消息；输入结束返回 false */
bool readMessage(Json& out) {
    for (;;) {
        size_t headerEnd = g_inBuf.find("\r\n\r\n");
        if (headerEnd != std::string::npos) {
            size_t length = 0;
            bool found = false;
            size_t pos = 0;
            while (pos < headerEnd) {
                size_t lineEnd = g_inBuf.find("\r\n", pos);
                if (lineEnd == std::string::npos || lineEnd > headerEnd) lineEnd = headerEnd;
                std::string line = g_inBuf.substr(pos, lineEnd - pos);
                if (line.size() > 15 && _strnicmp(line.c_str(), "Content-Length:", 15) == 0) {
                    length = static_cast<size_t>(strtoull(line.c_str() + 15, nullptr, 10));
                    found = true;
                }
                pos = lineEnd + 2;
            }
            size_t bodyStart = headerEnd + 4;
            if (!found) { g_inBuf.erase(0, bodyStart); continue; }
            while (g_inBuf.size() < bodyStart + length) if (!readMore()) return false;
            std::string body = g_inBuf.substr(bodyStart, length);
            g_inBuf.erase(0, bodyStart + length);
            Json msg;
            if (Parser(body).parse(msg)) { out = std::move(msg); return true; }
            continue;  // 坏消息丢弃
        }
        if (!readMore()) return false;
    }
}

void sendRaw(const std::string& body) {
    std::string frame = "Content-Length: " + std::to_string(body.size()) + "\r\n\r\n" + body;
    HANDLE h = GetStdHandle(STD_OUTPUT_HANDLE);
    DWORD written = 0;
    size_t offset = 0;
    while (offset < frame.size()) {
        if (!WriteFile(h, frame.data() + offset, static_cast<DWORD>(frame.size() - offset), &written, NULL) || written == 0) return;
        offset += written;
    }
}

void sendResult(const std::string& idJson, const std::string& resultJson) {
    sendRaw("{\"jsonrpc\":\"2.0\",\"id\":" + idJson + ",\"result\":" + resultJson + "}");
}

void sendError(const std::string& idJson, int code, const std::string& message) {
    sendRaw("{\"jsonrpc\":\"2.0\",\"id\":" + idJson + ",\"error\":{\"code\":" + std::to_string(code) + ",\"message\":" + quoted(message) + "}}");
}

void sendNotification(const char* method, const std::string& paramsJson) {
    sendRaw(std::string("{\"jsonrpc\":\"2.0\",\"method\":\"") + method + "\",\"params\":" + paramsJson + "}");
}

// ---------------------------------------------------------------------------
// 插件状态
// ---------------------------------------------------------------------------
std::deque<Json> g_queue;         // 等待宿主回复期间收到的其他消息
std::string g_currentId;          // 当前命令请求的 id（JSON 文本）；空 = 没有待回复的命令
std::vector<Json> g_currentArgs;
std::string g_pluginId;
std::string g_storagePath;
std::string g_lastError;
long long g_nextId = 1;

const char* keep(const std::string& s) {
    static thread_local std::string slots[8];
    static thread_local unsigned idx = 0;
    std::string& b = slots[(idx++) & 7u];
    b = s;
    return b.c_str();
}

std::string idText(const Json& msg) {
    const Json* id = msg.get("id");
    if (!id) return std::string();
    std::string out;
    serialize(out, *id);
    return out;
}

bool nextMessage(Json& out) {
    if (!g_queue.empty()) {
        out = std::move(g_queue.front());
        g_queue.pop_front();
        return true;
    }
    return readMessage(out);
}

}  // namespace

extern "C" const char* ycplugin_WaitRequest() {
    // 上一条命令没回复：自动回复空结果，免得宿主一直等
    if (!g_currentId.empty()) { sendResult(g_currentId, "null"); g_currentId.clear(); }
    g_currentArgs.clear();
    if (g_storagePath.empty()) {
        char buf[MAX_PATH * 4];
        DWORD n = GetEnvironmentVariableA("YCIDE_PLUGIN_STORAGE", buf, sizeof(buf));
        if (n > 0 && n < sizeof(buf)) g_storagePath.assign(buf, n);
    }
    Json msg;
    while (nextMessage(msg)) {
        std::string method = msg.str("method");
        std::string id = idText(msg);
        if (method.empty()) continue;  // 迟到的回复，忽略
        const Json* params = msg.get("params");
        if (method == "initialize") {
            sendResult(id, "{\"protocolVersion\":\"0.2\"}");
        } else if (method == "plugin/activate") {
            if (params) {
                g_pluginId = params->str("id");
                std::string storage = params->str("storagePath");
                if (!storage.empty()) g_storagePath = storage;
            }
            sendResult(id, "{\"commands\":[]}");
        } else if (method == "plugin/deactivate") {
            sendResult(id, "null");
        } else if (method == "shutdown") {
            sendResult(id, "null");
            return keep("");
        } else if (method == "commands/execute") {
            g_currentId = id;
            if (params) {
                const Json* args = params->get("args");
                if (args && args->kind == Json::Array) g_currentArgs = args->items;
            }
            return keep(params ? params->str("command") : std::string());
        } else if (!id.empty()) {
            sendError(id, -32601, "插件不支持方法 " + method);
        }
    }
    return keep("");  // 输入结束：IDE 已退出
}

extern "C" int ycplugin_GetArgCount() {
    return static_cast<int>(g_currentArgs.size());
}

extern "C" const char* ycplugin_GetArg(int index) {
    if (index < 1 || static_cast<size_t>(index) > g_currentArgs.size()) return keep("");
    return keep(toText(g_currentArgs[static_cast<size_t>(index) - 1]));
}

extern "C" void ycplugin_Reply(const char* result) {
    if (g_currentId.empty()) return;
    sendResult(g_currentId, quoted(result ? result : ""));
    g_currentId.clear();
}

extern "C" void ycplugin_ReplyError(const char* message) {
    if (g_currentId.empty()) return;
    sendError(g_currentId, -32603, message ? message : "");
    g_currentId.clear();
}

extern "C" void ycplugin_ShowMessage(const char* text, const char* type) {
    std::string kind = type && type[0] ? type : "info";
    sendNotification("window/showMessage", "{\"pluginId\":" + quoted(g_pluginId) + ",\"type\":" + quoted(kind) + ",\"message\":" + quoted(text ? text : "") + "}");
}

extern "C" void ycplugin_Output(const char* text) {
    sendNotification("output/append", "{\"pluginId\":" + quoted(g_pluginId) + ",\"type\":\"info\",\"text\":" + quoted(text ? text : "") + "}");
}

extern "C" const char* ycplugin_ExecuteCommand(const char* command, const char* arg) {
    g_lastError.clear();
    long long requestId = g_nextId++;
    std::string idJson = "\"ycplugin-" + std::to_string(requestId) + "\"";
    std::string args = arg && arg[0] ? "[" + quoted(arg) + "]" : "[]";
    sendRaw("{\"jsonrpc\":\"2.0\",\"id\":" + idJson + ",\"method\":\"commands/executeHost\",\"params\":{\"pluginId\":" +
            quoted(g_pluginId) + ",\"command\":" + quoted(command ? command : "") + ",\"args\":" + args + "}}");
    Json msg;
    while (readMessage(msg)) {
        if (msg.get("method") || idText(msg) != idJson) {
            g_queue.push_back(std::move(msg));  // 其他请求留给下一次「插件_等待请求」
            continue;
        }
        if (const Json* error = msg.get("error")) {
            const Json* code = error->get("code");
            g_lastError = (code ? toText(*code) + " " : std::string()) + error->str("message");
            return keep("");
        }
        const Json* result = msg.get("result");
        return keep(result && result->kind != Json::Null ? toText(*result) : std::string());
    }
    g_lastError = "IDE 已断开连接";
    return keep("");
}

extern "C" const char* ycplugin_GetLastError() {
    return keep(g_lastError);
}

extern "C" const char* ycplugin_GetPluginId() {
    return keep(g_pluginId);
}

extern "C" const char* ycplugin_GetStoragePath() {
    return keep(g_storagePath);
}
