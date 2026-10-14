# TikTok Shop 销量雷达采集器

云端直接读取 TikTok Shop 店铺商品，并将真实快照提交到私有雷达网页。

- 计划每五分钟采集；GitHub Actions 定时触发可能延迟，统计使用实际采样时间。
- 监控店铺名单从私有站点读取。
- 私有站点访问凭据使用 GitHub Actions secret `RADAR_SITE_TOKEN`。
- 累计已售计数包含退货，不等于净成交订单数。

后台任务将在安全凭据配置完成后启用。
