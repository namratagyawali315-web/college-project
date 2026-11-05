INSERT IGNORE INTO categories (id, name, sort_order, is_active) VALUES
  (1, 'Momo & Snacks', 10, 1),
  (2, 'Main Course', 20, 1),
  (3, 'Fast Food', 30, 1),
  (4, 'Beverages', 40, 1),
  (5, 'Desserts', 50, 1);

INSERT IGNORE INTO menu_items
  (id, category_id, name, description, price_paisa, image_path, is_available, is_archived, sort_order)
VALUES
  (1, 1, 'Veg Steam Momo', 'Steamed vegetable dumplings served with chutney', 12000, NULL, 1, 0, 10),
  (2, 1, 'Chicken Steam Momo', 'Steamed chicken dumplings served with chutney', 15000, NULL, 1, 0, 20),
  (3, 1, 'Veg Fried Momo', 'Crispy fried vegetable momos', 14000, NULL, 1, 0, 30),
  (4, 1, 'Chicken Fried Momo', 'Crispy fried chicken momos', 17000, NULL, 1, 0, 40),
  (5, 1, 'Sadeko Momo', 'Spicy tossed momos with house spices', 16000, NULL, 1, 0, 50),
  (6, 2, 'Veg Thali', 'Rice, dal, seasonal vegetables, pickle, and salad', 18000, NULL, 1, 0, 10),
  (7, 2, 'Chicken Thali', 'Rice, dal, chicken curry, pickle, and salad', 25000, NULL, 1, 0, 20),
  (8, 2, 'Egg Fried Rice', 'Fried rice with egg and vegetables', 14000, NULL, 1, 0, 30),
  (9, 2, 'Chicken Fried Rice', 'Fried rice with chicken and vegetables', 18000, NULL, 1, 0, 40),
  (10, 3, 'Veg Chowmein', 'Stir-fried noodles with vegetables', 10000, NULL, 1, 0, 10),
  (11, 3, 'Chicken Chowmein', 'Stir-fried noodles with chicken and vegetables', 13000, NULL, 1, 0, 20),
  (12, 3, 'Veg Burger', 'Vegetable patty burger with fresh salad', 12000, NULL, 1, 0, 30),
  (13, 3, 'Chicken Burger', 'Crispy chicken burger with fresh salad', 16000, NULL, 1, 0, 40),
  (14, 3, 'French Fries', 'Crispy potato fries with tomato sauce', 10000, NULL, 1, 0, 50),
  (15, 4, 'Masala Tea', 'Hot milk tea with cardamom and spices', 3000, NULL, 1, 0, 10),
  (16, 4, 'Coffee', 'Hot instant coffee', 6000, NULL, 1, 0, 20),
  (17, 4, 'Lemon Tea', 'Refreshing hot lemon tea', 4000, NULL, 1, 0, 30),
  (18, 4, 'Cold Drink', 'Chilled bottled soft drink', 8000, NULL, 1, 0, 40),
  (19, 5, 'Dahi', 'Sweetened fresh curd', 6000, NULL, 1, 0, 10),
  (20, 5, 'Gulab Jamun', 'Two pieces of warm gulab jamun', 7000, NULL, 1, 0, 20);

INSERT IGNORE INTO dining_tables (table_number, label, qr_token, is_active) VALUES
  ('1', 'Window Side', LOWER(SHA2(CONCAT(UUID(), RAND()), 256)), 1),
  ('2', 'Window Side', LOWER(SHA2(CONCAT(UUID(), RAND()), 256)), 1),
  ('3', 'Center Hall', LOWER(SHA2(CONCAT(UUID(), RAND()), 256)), 1),
  ('4', 'Center Hall', LOWER(SHA2(CONCAT(UUID(), RAND()), 256)), 1),
  ('5', 'Center Hall', LOWER(SHA2(CONCAT(UUID(), RAND()), 256)), 1),
  ('6', 'Corner Booth', LOWER(SHA2(CONCAT(UUID(), RAND()), 256)), 1),
  ('7', 'Corner Booth', LOWER(SHA2(CONCAT(UUID(), RAND()), 256)), 1),
  ('8', 'Garden View', LOWER(SHA2(CONCAT(UUID(), RAND()), 256)), 1),
  ('9', 'Garden View', LOWER(SHA2(CONCAT(UUID(), RAND()), 256)), 1),
  ('10', 'Main Hall', LOWER(SHA2(CONCAT(UUID(), RAND()), 256)), 1);
