insert into public.notification_templates
(organisation_id, broker_user_id, template_key, channel, title_template, body_template)
values
(null,null,'conditional_approval','in_app','🎉 Conditional approval','Hi {{client_first_name}}, good news! Your {{application_description}} application has conditional approval. There may still be lender requirements to complete; I’ll guide you through the next steps. – {{broker_first_name}}'),
(null,null,'formal_approval','in_app','✅ Full approval','Hi {{client_first_name}}, your {{application_description}} application has received full approval! I’ll keep you updated as we prepare for settlement. – {{broker_first_name}}'),
(null,null,'settlement_scheduled','in_app','🏡 Settlement is coming up','Hi {{client_first_name}}, your {{application_description}} application is on its way to settlement. I’ll be in touch with the details and anything you need to prepare. – {{broker_first_name}}'),
(null,null,'settlement_confirmation','in_app','🔑 Your loan has settled','Congratulations, {{client_first_name}}! Your {{application_description}} loan has settled. Thank you for trusting me to help you get here. I’m here whenever you need support. – {{broker_first_name}}'),
(null,null,'settlement_1_month','in_app','👋 One-month check-in','Hi {{client_first_name}}, it has been a month since settlement. How is everything going with your new loan? If you have any questions, just reply here. – {{broker_first_name}}'),
(null,null,'settlement_3_month','in_app','📋 Three-month check-in','Hi {{client_first_name}}, three months have flown by! If you would like to check how your loan is working for you or talk through any questions, I’m here to help. – {{broker_first_name}}'),
(null,null,'settlement_6_month','in_app','🔎 Six-month loan review','Hi {{client_first_name}}, it has been six months since settlement. Would you like to review your loan and see whether it still suits your plans? Send me a message anytime. – {{broker_first_name}}'),
(null,null,'settlement_12_month','in_app','📅 Your first annual review','Hi {{client_first_name}}, it has been a year since settlement. Let’s check that your loan still suits your needs and goals. Reply here and we can arrange a review. – {{broker_first_name}}'),
(null,null,'settlement_annual','in_app','🔁 Time for your annual review','Hi {{client_first_name}}, it is time for your annual loan review. If your circumstances or plans have changed, let’s look at your options together. – {{broker_first_name}}')
on conflict (template_key,channel) where organisation_id is null and broker_user_id is null do nothing;
