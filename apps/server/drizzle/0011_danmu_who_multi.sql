-- 弹幕规则的发送人条件从单选换成多选（和 @starfall/shared 的 danmuWhoFromOld 一致）：以前的「戴本房间粉丝牌」也算上大航海和房管
UPDATE `rule_danmu` SET `who` = CASE `who`
  WHEN 'all' THEN '{"all":true,"anchor":false,"mod":false,"guards":[],"fanMin":null,"uids":[]}'
  WHEN 'fan' THEN '{"all":false,"anchor":false,"mod":true,"guards":[1,2,3],"fanMin":1,"uids":[]}'
  WHEN 'fan10' THEN '{"all":false,"anchor":false,"mod":false,"guards":[],"fanMin":10,"uids":[]}'
  WHEN 'guard' THEN '{"all":false,"anchor":false,"mod":false,"guards":[1,2,3],"fanMin":null,"uids":[]}'
  WHEN 'mod' THEN '{"all":false,"anchor":false,"mod":true,"guards":[],"fanMin":null,"uids":[]}'
  ELSE '{"all":true,"anchor":false,"mod":false,"guards":[],"fanMin":null,"uids":[]}'
END
WHERE `who` NOT LIKE '{%';
