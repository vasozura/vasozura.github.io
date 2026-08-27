import { appConfig } from "../config";
import { requireSupabase } from "../lib/supabase";
import { fileRules, safeStorageFilename, validateFile, type UploadFileType } from "../utils/file-validation";

export interface UploadedSongFile {
  publicUrl: string;
  storagePath: string;
  checksum: string;
  duplicate: boolean;
}

async function sha256(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function xhrUpload(bucket: string, path: string, file: File, token: string, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${appConfig.supabaseUrl}/storage/v1/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", appConfig.supabaseAnonKey);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    xhr.addEventListener("load", () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText}`)));
    xhr.addEventListener("error", () => reject(new Error("Upload failed because of a network error.")));
    xhr.send(file);
  });
}

export async function uploadSongFile(songId: string, slug: string, fileType: UploadFileType, file: File, onProgress: (percent: number) => void): Promise<UploadedSongFile> {
  const issues = validateFile(file, fileType);
  if (issues.length) throw new Error(issues.join(" "));
  const supabase = requireSupabase();
  const checksum = await sha256(file);
  const { data: duplicate, error: duplicateError } = await supabase.from("song_files").select("public_url,storage_path").eq("song_id", songId).eq("checksum", checksum).maybeSingle();
  if (duplicateError) throw duplicateError;
  if (duplicate) return { publicUrl: String(duplicate.public_url), storagePath: String(duplicate.storage_path), checksum, duplicate: true };

  const rule = fileRules[fileType];
  const path = `${slug}/${Date.now()}-${safeStorageFilename(file.name)}`;
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("The owner session has expired. Please sign in again.");
  onProgress(0);
  await xhrUpload(rule.bucket, path, file, token, onProgress);
  onProgress(100);
  const publicUrl = supabase.storage.from(rule.bucket).getPublicUrl(path).data.publicUrl;
  const { data: latestVersion } = await supabase.from("song_files").select("version").eq("song_id", songId).eq("file_type", fileType).order("version", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from("song_files").insert({
    song_id: songId,
    file_type: fileType,
    storage_path: path,
    public_url: publicUrl,
    original_filename: file.name,
    mime_type: file.type || "application/octet-stream",
    file_size: file.size,
    checksum,
    version: Number(latestVersion?.version ?? 0) + 1,
  });
  if (error) throw error;
  return { publicUrl, storagePath: path, checksum, duplicate: false };
}
