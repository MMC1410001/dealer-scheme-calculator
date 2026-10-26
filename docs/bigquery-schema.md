# BigQuery schema – example-project.Testdb (read 16-10-2026)

Source: `INFORMATION_SCHEMA.COLUMNS`, read through the BigQuery console on 16-10-2026.
Only the tables that the scheme calculator may use are listed. Column order is the table order.

## zsd_sales
invoice_date:DATE, billing_date:DATE, inv_qty:STRING, inv_vol:STRING, order_reason_code:STRING, order_desc:STRING, stor_location:STRING, batch:STRING, sales_office:STRING, divison:STRING, dealer_depot_code:STRING, billing_depot:STRING, customer_code:STRING, customer_name:STRING, ship_to_party_number:STRING, ship_to_party_name:STRING, distribution_channel:STRING, billing_type:STRING, billing_description:STRING, order_sto_no:STRING, order_date:DATE, order_qty:STRING, order_vol:STRING, del_code:STRING, del_date:DATE, del_qty:STRING, del_vol:STRING, pending_qty:STRING, pending_vol:STRING, dispatch_indicator_y:STRING, ty_code:STRING, sku_code:STRING, sku_description:STRING, gross_sales_revenue:STRING, taxable_value:STRING, total_value:STRING, item_rate:STRING, line_item:STRING, inv_no:STRING, delivery_typ:STRING, cost_price:STRING, gross_weight:STRING, net_weight:STRING, clearing_payment_ter:STRING, billing_payment_term:STRING, product_code:STRING, zone_name:STRING, region_name:STRING, sales_office_name:STRING, territory_name:STRING, depot_name:STRING, state_name:STRING, city:STRING, customer_group:STRING, tax__rs:STRING, value_sales:STRING, inbill:STRING, cash_discount:STRING, local_upcountry:STRING, invoice_time:STRING, data_month:DATE

## zsd_billing
invoice_date:STRING, invoice_time:STRING, billing_date:STRING, inv_qty:STRING, order_reason_code:STRING, order_desc:STRING, stor_location:STRING, batch:STRING, sales_office:STRING, divison:STRING, billing_depot:STRING, customer_code:STRING, customer_name:STRING, local_upcountry:STRING, ship_to_party_number:STRING, ship_to_party_name:STRING, distribution_channel:STRING, billing_type:STRING, billing_description:STRING, order_qty:STRING, order_vol:STRING, del_code:STRING, del_qty:STRING, pending_qty:STRING, pending_vol:STRING, dispatch_indicator_y:STRING, ty_code:STRING, sku_code:STRING, sku_description:STRING, gross_sales_revenue:STRING, taxable_value:STRING, total_value:STRING, item_rate:STRING, line_item:STRING, inv_no:STRING, delivery_typ:STRING, cost_price:STRING, gross_weight:STRING, net_weight:STRING, zone:STRING, region_name:STRING, source_plant:STRING, materialxbatch:STRING, dpl:STRING, parent:STRING, new_revised_gsr:STRING, original_cd:STRING, in_bill:STRING, data_month:DATE

## zsd_billing_report (processed billing; many scheme CN columns omitted here)
invoice_date:STRING, inv_qty:STRING, batch:STRING, billing_depot:STRING, customer_code:STRING, customer_name:STRING, ship_to_party_name:STRING, distribution_channel:STRING, billing_type:STRING, billing_description:STRING, del_code:STRING, sku_code:STRING, sku_description:STRING, new_revised_gsr:STRING, gross_sales_revenue:STRING, taxable_value:STRING, total_value:STRING, item_rate:STRING, line_item:STRING, inv_no:STRING, source_plant:STRING, stor_location:STRING, materialxbatch:STRING, dpl:STRING, in_bill:STRING, original_cd:STRING, billing_date:STRING, order_qty:STRING, order_vol:STRING, parent:STRING, zone:STRING, product_category:STRING, CF:STRING, paid_free:STRING, data_month:DATE, final_vol:NUMERIC, trip_scheme_category:STRING, dealer_loyalty:NUMERIC, ..., invoice_date_year:STRING, invoice_date_quarter:STRING, invoice_date_month:STRING, sku_region:STRING, month:INT64, cd:NUMERIC, in_bill_final:NUMERIC, franchise_scheme:FLOAT64, boss_scheme:FLOAT64, trip_scheme:NUMERIC, ..., tools_cn:NUMERIC, masking_tapes_cn:NUMERIC, sandpapers_cn:NUMERIC, stainers_cn:NUMERIC, ..., trip_gain_cn:NUMERIC

## parent_child
parent:STRING, child:STRING, data_month:DATE

## customer_attributes (dealer master)
dealer_code:STRING, dealer_name:STRING, zone:STRING, region_code:STRING, region_name:STRING, territory_code:STRING, territory_name:STRING, state_name:STRING, local_upcountry:STRING, depot_code:STRING, depot_name:STRING, data_month:DATE

## mapping_of_franchise
dealer_code:STRING, firm_name:STRING, type_of_franchisee:STRING, data_month:DATE

## Product_Attributes
product_name:STRING, material_code:STRING, right_3:STRING, product_cat:STRING, _10p:STRING, category:STRING, material_product_name:STRING, woodcraft:STRING, product_category:STRING, sub_brand:STRING, cf:STRING, paid_free:STRING, column_2:STRING, data_month:DATE

## test_product (product master)
skucode, skuname, baseproduct, baseproductname, shadecode, shadename, packcode, packsize, brandcode, brandname, subbrandcode, subbrandname, categorycode, categoryname, subcategorycode, p_subcategoryname, division, substratecode, substrate, productgrpcode, productgrp, chemistrycode, chemistry, seriescode, series, conversionvalue, approvalstatus, unit, productshortname, packvalue, packunit, tintedfandeck, tintedfandeckname, producttype, volumevalue, volumeuom, marketingcategory, materialtype, paidfree (all STRING), loaded_date:DATE

## Trip_Scheme_SKUs
category:STRING, sub_brand:STRING, product_codes:STRING, product_name:STRING, points:STRING, eligible:STRING, data_month:DATE

## Other tables seen (not used yet)
test_customer (customer master with region, distribution_channel, dealer_type), scheme_mapping (SKU × scheme flags), woodcraft_sku_mapping, cd_adjustment.
