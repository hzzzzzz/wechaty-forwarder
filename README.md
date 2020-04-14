# 基于 [Wechaty](https://github.com/juzibot/wechaty) 的微信消息转发机器人

## 简介
  将微信消息转发至微信群

## 说明
  1. 项目基于 [wechaty](https://github.com/juzibot/wechaty) 及 [wechaty-puppet-macpro](https://github.com/juzibot/wechaty-puppet-macpro)

  1. 外部依赖：mongoDb

  1. 暂时只支持转发文字消息

  1. token 请自行[申请](https://github.com/juzibot/Welcome/wiki/Everything-about-Wechaty#2%E5%A6%82%E4%BD%95%E7%94%B3%E8%AF%B7%E5%85%8D%E8%B4%B9token)

  1. 配置文件目录: config/

  1. 服务端入口: src/server/server.js

  1. 客户端需用 [webSocket](https://github.com/heineiuo/isomorphic-ws) 连接服务端以获取 push 的登录二维码等信息

  1. 不包含客户端部分

## 接口

  - http API (所有参数由 queryString 传递):

  | 路径 | 方法 | 参数 | 描述 |
  | :--- | :--- | :--- | :--- |
  | /api/start | POST | - | 启动机器人 |
  | /api/logout | POST | - | 账号登出 |
  | /api/message | GET | [from]: 消息发送者的 ID<br>[limit]: 返回消息数量上限 | 获取直接发给机器人的消息列表 |
  | /api/group | GET | - | 获取微信群列表 |
  | /api/message/forward | POST | msgId (String \| Array) : 转发的消息 ID<br>groupId (String \| Array) : 目标群 ID | 将消息转发至微信群 |


  - webSocket pushed message (`data` 字段 ):

  | 参数 | 取值 | 描述 |
  | :-- | :-- | :-- |
  | botStatus | online<br>scanning<br>offline | 登录状态 |
  | scanStatus | Unknown<br>Cancel<br>Waiting<br>Scanned<br>Confirmed<br>Timeout | 扫码状态 |
  | action | confirm: 需要手机微信确认登录<br>scan: 需要手机微信扫描二维码 | 需要进行的操作 |
  | qrCode | - | 二维码链接 |
