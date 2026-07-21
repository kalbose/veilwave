package ru.samara.wave;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

@CapacitorPlugin(name = "RswSave")
public class RswSavePlugin extends Plugin {

    private static final String FOLDER = "RuSamaraWave";

    @PluginMethod
    public void saveFile(PluginCall call) {
        String name = call.getString("name");
        String dataB64 = call.getString("data");
        String mime = call.getString("mime", "application/octet-stream");
        if (name == null || name.isEmpty() || dataB64 == null || dataB64.isEmpty()) {
            call.reject("name and data required");
            return;
        }

        name = new File(name).getName();

        try {
            byte[] bytes = Base64.decode(dataB64, Base64.DEFAULT);
            String relativePath;
            Uri uri;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                relativePath = Environment.DIRECTORY_DOWNLOADS + "/" + FOLDER;
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, name);
                values.put(MediaStore.Downloads.MIME_TYPE, mime);
                values.put(MediaStore.Downloads.RELATIVE_PATH, relativePath);
                values.put(MediaStore.Downloads.IS_PENDING, 1);

                ContentResolver resolver = getContext().getContentResolver();
                uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) {
                    call.reject("не удалось создать файл в Downloads/" + FOLDER);
                    return;
                }
                try (OutputStream out = resolver.openOutputStream(uri)) {
                    if (out == null) {
                        call.reject("не удалось открыть поток записи");
                        return;
                    }
                    out.write(bytes);
                }
                values.clear();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                resolver.update(uri, values, null, null);
            } else {
                File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                File dir = new File(downloads, FOLDER);
                if (!dir.exists() && !dir.mkdirs()) {
                    call.reject("не удалось создать папку Downloads/" + FOLDER);
                    return;
                }
                File file = new File(dir, name);
                try (FileOutputStream out = new FileOutputStream(file)) {
                    out.write(bytes);
                }
                uri = Uri.fromFile(file);
                relativePath = "Download/" + FOLDER;
            }

            JSObject ret = new JSObject();
            ret.put("uri", uri.toString());
            ret.put("path", relativePath + "/" + name);
            ret.put("folder", "Download/" + FOLDER);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("ошибка сохранения: " + e.getMessage(), e);
        }
    }
}
