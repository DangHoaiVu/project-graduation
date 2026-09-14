import { createClient } from '@supabase/supabase-js';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { loadEnvFile } from 'node:process';
import serviceAccount from './lms-assistant-15000-firebase-adminsdk-fbsvc-6733fe551b.json' with { type: 'json' };

loadEnvFile(new URL('../.dev.vars', import.meta.url));

// Khởi tạo Supabase và Firebase
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);
initializeApp({
  credential: cert(serviceAccount)
});
const db = getFirestore();

async function migrateToFirebase() {
  const tablesToMigrate = ['chat_sessions', 'personal_materials', 'learning_artifacts'];

  for (const tableName of tablesToMigrate) {
    console.log(`Đang tải dữ liệu từ bảng: ${tableName}...`);
    
    // Kéo toàn bộ dữ liệu từ Supabase
    const { data, error } = await supabase.from(tableName).select('*');
    if (error) {
      console.error(`Lỗi tải bảng ${tableName}:`, error.message);
      continue;
    }

    if (!data || data.length === 0) {
      console.log(`Bảng ${tableName} trống, bỏ qua.`);
      continue;
    }

    // Sử dụng Firestore Batched Writes để đẩy dữ liệu lên nhanh hơn (giới hạn 500 document/batch)
    let batch = db.batch();
    let count = 0;

    for (const row of data) {
      // Sử dụng ID uuid của Supabase làm Document ID trên Firestore
      const docRef = db.collection(tableName).doc(row.id);
      
      // Convert các trường timestamp (ví dụ: updated_at) sang dạng chuẩn ISO nếu cần
      batch.set(docRef, row);
      count++;

      // Commit batch mỗi 500 bản ghi
      if (count === 500) {
        await batch.commit();
        batch = db.batch();
        count = 0;
      }
    }

    // Commit những bản ghi còn sót lại cuối cùng
    if (count > 0) {
      await batch.commit();
    }
    
    console.log(`Hoàn tất chuyển ${data.length} bản ghi của ${tableName} sang Firestore.`);
  }
}

migrateToFirebase().catch(console.error);